import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { DocumentsModule } from './documents/documents.module';

@Module({
  imports: [DatabaseModule, DocumentsModule],
})
export class AppModule {}
