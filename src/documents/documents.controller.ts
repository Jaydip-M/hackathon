import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateDocumentDto } from './dto/create-document.dto';
import { DocumentsService } from './documents.service';
import { PdfParserService } from './pdf-parser.service';

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly pdfParser: PdfParserService,
  ) {}

  @Post()
  async create(@Body() dto: CreateDocumentDto) {
    const title = (dto.title ?? dto.name)?.trim() || 'Untitled';
    const file_name = dto.file_name?.trim() ?? '';
    return this.documentsService.create(title, file_name, dto.pages ?? []);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPdf(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Missing file. Send as multipart form with field "file".');
    }
    const pages = await this.pdfParser.extractTextPerPage(file.buffer);
    const title = (name && String(name).trim()) || file.originalname || 'Untitled';
    const file_name = file.originalname || 'upload.pdf';
    return this.documentsService.create(title, file_name, pages);
  }

  @Get('search')
  async search(@Query('q') q: string) {
    return this.documentsService.search(q ?? '');
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.documentsService.findOne(id);
  }
}
