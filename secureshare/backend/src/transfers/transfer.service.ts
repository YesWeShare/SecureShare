import {
  BadRequestException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TransferStatus } from '@prisma/client';
import * as opaque from '@serenity-kit/opaque';
import { createHmac, randomBytes, randomInt, timingSafeEqual, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { CreateTransferDto } from './transfer.dto';

const maximumTransferSize = 50 * 1024 * 1024;
const uploadSessionLifetimeMs = 24 * 60 * 60 * 1000;
const cleanupIntervalMs = 5 * 60 * 1000;
const opaqueSessionLifetimeMs = 3 * 60 * 1000;
const maximumCodeAttempts = 5;
const codeAttemptWindowMs = 60 * 1000;

type OpaqueSession = { transferId: string; serverLoginState: string; expiresAt: number };
type CodeAttemptWindow = { count: number; resetsAt: number };

@Injectable()
export class TransferService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransferService.name);
  private readonly lookupSecret: string;
  private readonly opaqueServerSetup: string;
  private readonly opaqueSessions = new Map<string, OpaqueSession>();
  private readonly codeAttempts = new Map<string, CodeAttemptWindow>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    config: ConfigService,
  ) {
    this.lookupSecret = config.get('TRANSFER_LOOKUP_SECRET', '');
    this.opaqueServerSetup = config.get('OPAQUE_SERVER_SETUP', '');
    if (Buffer.byteLength(this.lookupSecret) < 32) {
      throw new Error('TRANSFER_LOOKUP_SECRET must contain at least 32 bytes');
    }
    if (!this.opaqueServerSetup) throw new Error('OPAQUE_SERVER_SETUP is required');
  }

  async onModuleInit(): Promise<void> {
    await opaque.ready;
    this.cleanupTimer = setInterval(() => void this.cleanupSafely(), cleanupIntervalMs);
    this.cleanupTimer.unref();
    await this.cleanupSafely();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async createTransfer(input: CreateTransferDto) {
    const totalSize = input.files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize !== input.totalSize || totalSize > maximumTransferSize) {
      throw new BadRequestException('The transfer must contain between 1 byte and 50 MB of files');
    }

    const expiresAt = new Date(Date.now() + uploadSessionLifetimeMs);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = randomUUID();
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const ownerToken = randomBytes(32).toString('base64url');
      const files = input.files.map(file => {
        const fileId = randomUUID();
        return {
          id: fileId,
          objectKey: `${id}/${fileId}-${randomUUID()}.bin`,
          originalSize: file.size,
          encryptedSize: file.size + 16,
        };
      });

      try {
        await this.prisma.transfer.create({
          data: {
            id,
            ownerTokenHash: this.hashSecret('owner', ownerToken),
            totalSize,
            fileCount: files.length,
            storageDurationDays: input.durationDays,
            expiresAt,
            files: { create: files },
            transferCode: { create: { codeHash: this.hashSecret('code', code), expiresAt } },
          },
        });
        return {
          transferId: id,
          code,
          ownerToken,
          expiresAt,
          durationDays: input.durationDays,
          files: files.map(({ id: fileId, originalSize }) => ({ id: fileId, originalSize })),
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }

    throw new InternalServerErrorException('Could not allocate a unique transfer code');
  }

  async startRegistration(id: string, ownerToken: string | undefined, registrationRequest: string) {
    await this.getOwnedUploadingTransfer(id, ownerToken);
    const { registrationResponse } = opaque.server.createRegistrationResponse({
      serverSetup: this.opaqueServerSetup,
      userIdentifier: id,
      registrationRequest,
    });
    return { registrationResponse };
  }

  async uploadFile(id: string, fileId: string, ownerToken: string | undefined, buffer: Buffer) {
    const transfer = await this.getOwnedUploadingTransfer(id, ownerToken);
    const file = transfer.files.find(item => item.id === fileId);
    if (!file) throw new NotFoundException('Transfer file not found');
    if (buffer.length !== file.encryptedSize) throw new BadRequestException('Encrypted file size did not match');

    try {
      await this.storage.put(file.objectKey, buffer);
      await this.prisma.transferFile.update({ where: { id: file.id }, data: { uploadedAt: new Date() } });
    } catch {
      await this.storage.delete(file.objectKey).catch(() => undefined);
      throw new InternalServerErrorException('Encrypted file storage failed');
    }
    return { uploaded: true, bytesStored: buffer.length };
  }

  async completeTransfer(id: string, ownerToken: string | undefined, input: {
    registrationRecord: string;
    encryptedKeyEnvelope: string;
    encryptedMetadata: string;
  }) {
    const transfer = await this.getOwnedUploadingTransfer(id, ownerToken);
    if (!input.registrationRecord || !input.encryptedKeyEnvelope || !input.encryptedMetadata) {
      throw new BadRequestException('Encrypted transfer metadata is incomplete');
    }
    for (const file of transfer.files) {
      if (!file.uploadedAt || !(await this.storage.exists(file.objectKey))) {
        throw new BadRequestException('Not all encrypted files have been stored');
      }
    }

    const uploadedAt = new Date();
    const expiresAt = new Date(uploadedAt.getTime() + transfer.storageDurationDays * 24 * 60 * 60 * 1000);
    await this.prisma.$transaction(async transaction => {
      const updated = await transaction.transfer.updateMany({
        where: { id, status: TransferStatus.UPLOADING, expiresAt: { gt: uploadedAt } },
        data: {
          opaqueRegistration: input.registrationRecord,
          encryptedKeyEnvelope: input.encryptedKeyEnvelope,
          encryptedMetadata: input.encryptedMetadata,
          uploadedAt,
          expiresAt,
          status: TransferStatus.ACTIVE,
        },
      });
      if (updated.count !== 1) throw new GoneException('Transfer expired before it could be completed');
      await transaction.transferCode.update({ where: { transferId: id }, data: { expiresAt } });
    });
    return {
      transferId: id,
      status: 'ACTIVE',
      uploadedAt,
      durationDays: transfer.storageDurationDays,
      expiresAt,
    };
  }

  async startCodeReceive(ip: string, code: string, startLoginRequest: string) {
    this.recordCodeAttempt(ip);
    const codeRecord = await this.prisma.transferCode.findUnique({
      where: { codeHash: this.hashSecret('code', code) },
    });
    if (!codeRecord || codeRecord.expiresAt <= new Date()) throw new NotFoundException('Invalid or expired transfer code');
    const transfer = await this.getActiveTransfer(codeRecord.transferId);
    if (!transfer.opaqueRegistration) throw new GoneException('Transfer is not ready to receive');

    try {
      const { serverLoginState, loginResponse } = opaque.server.startLogin({
        serverSetup: this.opaqueServerSetup,
        userIdentifier: transfer.id,
        registrationRecord: transfer.opaqueRegistration,
        startLoginRequest,
      });
      const sessionId = randomUUID();
      this.opaqueSessions.set(sessionId, {
        transferId: transfer.id,
        serverLoginState,
        expiresAt: Date.now() + opaqueSessionLifetimeMs,
      });
      return { sessionId, loginResponse };
    } catch {
      throw new UnauthorizedException('Invalid transfer code');
    }
  }

  async finishCodeReceive(sessionId: string, finishLoginRequest: string) {
    const session = this.opaqueSessions.get(sessionId);
    this.opaqueSessions.delete(sessionId);
    if (!session || session.expiresAt <= Date.now()) throw new UnauthorizedException('Transfer verification expired; try again');

    try {
      opaque.server.finishLogin({
        serverLoginState: session.serverLoginState,
        finishLoginRequest,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired transfer code');
    }
    return this.getManifest(session.transferId);
  }

  async getManifest(id: string) {
    const transfer = await this.getActiveTransfer(id);
    if (!transfer.encryptedKeyEnvelope || !transfer.encryptedMetadata) {
      throw new GoneException('Transfer is not ready to receive');
    }
    return {
      transferId: transfer.id,
      expiresAt: transfer.expiresAt,
      uploadedAt: transfer.uploadedAt,
      durationDays: transfer.storageDurationDays,
      fileCount: transfer.fileCount,
      downloadCount: transfer.downloadCount,
      status: transfer.status,
      totalSize: transfer.totalSize,
      encryptedKeyEnvelope: transfer.encryptedKeyEnvelope,
      encryptedMetadata: transfer.encryptedMetadata,
      files: transfer.files.map(file => ({ id: file.id, encryptedSize: file.encryptedSize })),
    };
  }

  async downloadFile(transferId: string, fileId: string): Promise<Buffer> {
    const transfer = await this.getActiveTransfer(transferId);
    const file = transfer.files.find(item => item.id === fileId);
    if (!file || !file.uploadedAt) throw new NotFoundException('Transfer file not found');
    const record = await this.prisma.downloadRecord.create({ data: { transferId, status: 'REQUESTED' } });
    try {
      const bytes = await this.storage.get(file.objectKey);
      await this.prisma.$transaction([
        this.prisma.downloadRecord.update({ where: { id: record.id }, data: { status: 'COMPLETED', completedAt: new Date() } }),
        this.prisma.transferFile.update({ where: { id: file.id }, data: { downloadStatus: 'COMPLETED' } }),
        this.prisma.transfer.update({ where: { id: transferId }, data: { downloadCount: { increment: 1 } } }),
      ]);
      return bytes;
    } catch {
      await this.prisma.downloadRecord.update({ where: { id: record.id }, data: { status: 'FAILED' } });
      throw new NotFoundException('Encrypted file is no longer available');
    }
  }

  async deleteTransfer(id: string, ownerToken: string | undefined): Promise<{ deleted: true }> {
    const transfer = await this.prisma.transfer.findUnique({ where: { id }, include: { files: true } });
    this.assertOwner(transfer, ownerToken);
    await Promise.all(transfer.files.map(file => this.storage.delete(file.objectKey)));
    await this.prisma.transfer.update({ where: { id }, data: { status: TransferStatus.DELETED, deletedAt: new Date() } });
    await this.prisma.transferCode.deleteMany({ where: { transferId: id } });
    return { deleted: true };
  }

  private async getActiveTransfer(id: string) {
    const transfer = await this.prisma.transfer.findUnique({ where: { id }, include: { files: true } });
    if (!transfer || transfer.status === TransferStatus.DELETED) throw new NotFoundException('Transfer not found');
    if (transfer.status === TransferStatus.EXPIRED || transfer.expiresAt <= new Date()) {
      await this.expireTransfer(transfer);
      throw new GoneException('Transfer has expired');
    }
    if (transfer.status !== TransferStatus.ACTIVE) throw new NotFoundException('Transfer is not available');
    return transfer;
  }

  private async getOwnedUploadingTransfer(id: string, ownerToken: string | undefined) {
    const transfer = await this.prisma.transfer.findUnique({ where: { id }, include: { files: true } });
    this.assertOwner(transfer, ownerToken);
    if (transfer.status !== TransferStatus.UPLOADING || transfer.expiresAt <= new Date()) {
      throw new GoneException('Upload session is no longer available');
    }
    return transfer;
  }

  private assertOwner(
    transfer: Prisma.TransferGetPayload<{ include: { files: true } }> | null,
    token: string | undefined,
  ): asserts transfer is Prisma.TransferGetPayload<{ include: { files: true } }> {
    if (!transfer || !token) throw new NotFoundException('Transfer not found');
    const expected = Buffer.from(transfer.ownerTokenHash, 'hex');
    const provided = Buffer.from(this.hashSecret('owner', token), 'hex');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new NotFoundException('Transfer not found');
    }
  }

  private recordCodeAttempt(ip: string): void {
    const now = Date.now();
    const current = this.codeAttempts.get(ip);
    const window = !current || current.resetsAt <= now
      ? { count: 0, resetsAt: now + codeAttemptWindowMs }
      : current;
    if (window.count >= maximumCodeAttempts) {
      throw new HttpException('Too many code attempts; wait one minute and try again', HttpStatus.TOO_MANY_REQUESTS);
    }
    window.count += 1;
    this.codeAttempts.set(ip, window);
  }

  private hashSecret(purpose: string, value: string): string {
    return createHmac('sha256', this.lookupSecret).update(`${purpose}:${value}`).digest('hex');
  }

  private async expireTransfer(transfer: { id: string; files: Array<{ objectKey: string }> }): Promise<void> {
    await Promise.all(transfer.files.map(file => this.storage.delete(file.objectKey).catch(() => undefined)));
    await this.prisma.transfer.updateMany({
      where: { id: transfer.id, status: { in: [TransferStatus.ACTIVE, TransferStatus.UPLOADING] } },
      data: { status: TransferStatus.EXPIRED },
    });
    await this.prisma.transferCode.deleteMany({ where: { transferId: transfer.id } });
  }

  private async expireTransfers(): Promise<void> {
    const expired = await this.prisma.transfer.findMany({
      where: { status: { in: [TransferStatus.ACTIVE, TransferStatus.UPLOADING] }, expiresAt: { lte: new Date() } },
      select: { id: true, files: { select: { objectKey: true } } },
      take: 100,
    });
    for (const transfer of expired) await this.expireTransfer(transfer);
    for (const [id, session] of this.opaqueSessions) {
      if (session.expiresAt <= Date.now()) this.opaqueSessions.delete(id);
    }
    for (const [ip, window] of this.codeAttempts) {
      if (window.resetsAt <= Date.now()) this.codeAttempts.delete(ip);
    }
  }

  private async cleanupSafely(): Promise<void> {
    try {
      await this.expireTransfers();
    } catch {
      this.logger.error('Scheduled transfer cleanup failed');
    }
  }
}