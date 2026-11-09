import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const details = exception instanceof HttpException ? exception.getResponse() : 'Internal server error';
    const message = typeof details === 'string'
      ? details
      : typeof details === 'object' && details !== null && 'message' in details
        ? details.message
        : 'Request failed';
    response.status(status).json({ statusCode: status, message });
  }
}