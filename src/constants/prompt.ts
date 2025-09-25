export class PROMPT_CONSTANT {
    static EXTRACT_TEXT_FROM_PDF = `
You are given a PDF file. Your task is to **extract and return all content** as structured JSON.
Requirements:
- Parse every page in order, do not skip or summarize.
- Extract **all text** (paragraphs, tables, titles, captions).
- Run OCR on images and append the recognized text into "content" as if it were inline text.
- The final "content" must contain both original text and OCR text merged, in correct reading order.
- If a page has no title, leave "title" as an empty string "".
- Output **only valid JSON** following the exact schema, no extra escape characters.

Schema:
{
  "data": [
    {
      "pageNumber": number,
      "title": string,
      "content": string
    }
  ]
}
`;
}
