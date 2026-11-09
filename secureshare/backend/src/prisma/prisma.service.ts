import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super({
      log: [
        { emit: 'std.level', level: 'query' },
        { emit: 'std.error', level: 'error' },
        { emit: 'std.warning', level: 'warn' },
      ],
    });
  }
}