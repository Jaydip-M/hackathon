export class CreateDocumentDto {
  /** Document title (e.g. "Annual Report 2024"). Also accepts "name" as alias. */
  title?: string;
  /** Alias for title (legacy). Ignored if title is set. */
  name?: string;
  /** Original filename (optional; e.g. "annual_report.pdf") */
  file_name?: string;
  /** One string per page, in order */
  pages: string[];
}
