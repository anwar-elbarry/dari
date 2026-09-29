// Test helper: prints the text of the PDF read from stdin. Runs as its own Node process because pdf.js is ESM-only
// and cannot be loaded inside Jest's CommonJS VM.
import { Buffer } from 'node:buffer';
import { PDFParse } from 'pdf-parse';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const parser = new PDFParse({ data: new Uint8Array(Buffer.concat(chunks)) });
try {
  process.stdout.write((await parser.getText()).text);
} finally {
  await parser.destroy();
}
