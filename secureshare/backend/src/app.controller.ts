import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { AuthGuard } from './auth/auth.guard';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('upload/initialize')
  @UseGuards(AuthGuard)
  async initializeUpload(@Body() body: any, @Req() request: any) {
    return this.appService.initializeUpload(body, request.user);
  }

  @Post('transfer/qr')
  @UseGuards(AuthGuard)
  async createQrTransfer(@Body() body: any, @Req() request: any) {
    return this.appService.createQrTransfer(body, request.user);
  }

  @Post('transfer/code')
  @UseGuards(AuthGuard)
  async verifyCode(@Body() body: any, @Req() request: any) {
    return this.appService.verifyCode(body.code, request.user);
  }

  @Post('pairing/request')
  @UseGuards(AuthGuard)
  async requestPairing(@Body() body: any, @Req() request: any) {
    return this.appService.requestPairing(request.user, body.transferId);
  }

  @Post('pairing/approve')
  @UseGuards(AuthGuard)
  async approvePairing(@Body() body: any, @Req() request: any) {
    return this.appService.approvePairing(request.user, body.transferId, body.receiverPublicKey);
  }

  @Get('transfers')
  @UseGuards(AuthGuard)
  async getTransfers(@Req() request: any) {
    return this.appService.getTransfers(request.user);
  }

  @Delete('transfers/:id')
  @UseGuards(AuthGuard)
  async deleteTransfer(@Param('id') id: string, @Req() request: any) {
    return this.appService.deleteTransfer(id, request.user);
  }

  @Post('download/secure')
  @UseGuards(AuthGuard)
  async getSecureDownload(@Body() body: any, @Req() request: any) {
    return this.appService.getSecureDownload(body, request.user);
  }

  @Get('dashboard')
  @UseGuards(AuthGuard)
  async getDashboard(@Req() request: any) {
    return this.appService.getDashboard(request.user);
  }
}