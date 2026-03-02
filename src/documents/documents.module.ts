import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PdfParserService } from './pdf-parser.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, PdfParserService],
})
export class DocumentsModule {}
