import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { AppService } from './app.service';
import { TransferService } from './transfers/transfer.service';
import {
  CompleteTransferDto,
  CreateTransferDto,
  OpaqueRegistrationStartDto,
  ReceiveCodeFinishDto,
  ReceiveCodeStartDto,
} from './transfers/transfer.dto';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly transferService: TransferService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('transfers')
  createTransfer(@Body() body: CreateTransferDto) {
    return this.transferService.createTransfer(body);
  }

  @Post('transfers/:id/opaque/register/start')
  startRegistration(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-owner-token') ownerToken: string | undefined,
    @Body() body: OpaqueRegistrationStartDto,
  ) {
    return this.transferService.startRegistration(id, ownerToken, body.registrationRequest);
  }

  @Post('transfers/:id/files/:fileId')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 + 1600, files: 1 },
  }))
  uploadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Headers('x-owner-token') ownerToken: string | undefined,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ) {
    if (!file) throw new BadRequestException('Encrypted file body is required');
    return this.transferService.uploadFile(id, fileId, ownerToken, file.buffer);
  }

  @Post('transfers/:id/complete')
  completeTransfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-owner-token') ownerToken: string | undefined,
    @Body() body: CompleteTransferDto,
  ) {
    return this.transferService.completeTransfer(id, ownerToken, body);
  }

  @Get('transfers/:id/manifest')
  getManifest(@Param('id', ParseUUIDPipe) id: string) {
    return this.transferService.getManifest(id);
  }

  @Get('transfers/:id/files/:fileId')
  async downloadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() response: Response,
  ): Promise<void> {
    const encryptedFile = await this.transferService.downloadFile(id, fileId);
    response
      .set({
        'Content-Type': 'application/octet-stream',
        'Content-Length': encryptedFile.length,
        'Content-Disposition': 'attachment; filename="encrypted.bin"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      })
      .send(encryptedFile);
  }

  @Post('receive/code/start')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  startCodeReceive(@Ip() ip: string, @Body() body: ReceiveCodeStartDto) {
    return this.transferService.startCodeReceive(ip, body.code, body.startLoginRequest);
  }

  @Post('receive/code/finish')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  finishCodeReceive(@Body() body: ReceiveCodeFinishDto) {
    return this.transferService.finishCodeReceive(body.sessionId, body.finishLoginRequest);
  }

  @Delete('transfers/:id')
  deleteTransfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-owner-token') ownerToken: string | undefined,
  ) {
    return this.transferService.deleteTransfer(id, ownerToken);
  }
}