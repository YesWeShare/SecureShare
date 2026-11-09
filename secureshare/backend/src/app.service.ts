import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class AppService {
  private s3Client: any;
  private bucketName: string;

  constructor(private readonly prisma: PrismaService) {
    this.bucketName = 'secureshare-files';
  }

  onModuleInit() {
    // S3 client initialized with env vars in production
    this.s3Client = new S3Client({ region: 'us-east-1' });
  }

  async getHello(): string {
    return 'SecureShare API is running';
  }

  async register(fullName: string, email: string, password: string) {
    // Check if user exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ForbiddenException('Email already registered');
    }

    // Hash password
    const passwordHash = await this.hashPassword(password);

    const user = await this.prisma.user.create({
      data: {
        fullName,
        email,
        passwordHash,
        accountType: 'FREE',
        storageQuota: 50 * 1024 * 1024,
      },
    });

    return { id: user.id, fullName: user.fullName, email: user.email, accountType: user.accountType };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !(await this.verifyPassword(password, user.passwordHash))) {
      throw new ForbiddenException('Invalid credentials');
    }

    return { id: user.id, fullName: user.fullName, email: user.email, accountType: user.accountType };
  }

  private async hashPassword(password: string): Promise<string> {
    const crypto = require('crypto');
    const salt = randomBytes(32).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  private async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [salt, storedPasswordHash] = storedHash.split(':');
    const crypto = require('crypto');
    const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
    return derivedKey === storedPasswordHash;
  }

  async initializeUpload(fileName: string, fileSize: number, userId: string, accountType: string) {
    // Validate file size (50MB limit)
    const maxSize = accountType === 'PREMIUM' ? 100 * 1024 * 1024 : 50 * 1024 * 1024;
    if (fileSize > maxSize) {
      throw new ForbiddenException('File exceeds maximum size limit');
    }

    // Create transfer record
    const transferIdentifier = uuidv4().toString().substring(0, 8).toUpperCase();
    const expiresAt = accountType === 'PREMIUM' 
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days for premium
      : new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours for free

    const transfer = await this.prisma.transfer.create({
      data: {
        transferIdentifier,
        senderUserId: userId,
        transferStatus: 'ACTIVE',
        encryptedMetadata: '', // Will be updated after upload
        totalSize: fileSize,
        expiresAt,
      },
    });

    return {
      transferId: transfer.id,
      transferIdentifier: transfer.transferIdentifier,
      expiresAt: transfer.expiresAt,
      maxSize: accountType === 'PREMIUM' ? 100 * 1024 * 1024 : 50 * 1024 * 1024,
    };
  }