import io
import os
from dataclasses import dataclass

import pymupdf
import pdfplumber
from docx import Document


@dataclass
class ParseResult:
    text: str
    status: str  # "Parsed" | "Failed: scanned image" | "Failed: corrupt file" | "Failed: unsupported format"
    error: str | None = None


def _extract_pdf_text(data: bytes) -> tuple[str, int]:
    """Extract text using pdfplumber first, falling back to PyMuPDF (fitz)."""
    pages_count = 0
    collected: list[str] = []

    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            pages_count = len(pdf.pages)
            for page in pdf.pages:
                txt = page.extract_text() or ""
                if txt.strip():
                    collected.append(txt.strip())
    except Exception:
        collected = []

    joined = "\n".join(collected).strip()
    if len(joined) >= 40:
        return joined, pages_count

    # Fallback to PyMuPDF for multi-column / complex layouts
    doc = pymupdf.open(stream=data, filetype="pdf")
    try:
        pages_count = max(pages_count, len(doc))
        pymupdf_parts: list[str] = []
        for page in doc:
            txt = page.get_text("text") or ""
            if txt.strip():
                pymupdf_parts.append(txt.strip())
        fallback_text = "\n".join(pymupdf_parts).strip()
        if len(fallback_text) > len(joined):
            return fallback_text, pages_count
    finally:
        doc.close()

    return joined, pages_count


def _extract_docx_text(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    parts: list[str] = []
    for p in doc.paragraphs:
        if p.text.strip():
            parts.append(p.text.strip())
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return "\n".join(parts).strip()


def parse_document(filename: str, data: bytes) -> ParseResult:
    ext = os.path.splitext(filename.lower())[1]
    if not data:
        return ParseResult(text="", status="Failed: empty file", error="Empty file")

    try:
        if ext == ".pdf":
            text, pages = _extract_pdf_text(data)
            if len(text.strip()) < 30:
                if pages > 0:
                    return ParseResult(
                        text="",
                        status="Failed: scanned image",
                        error="PDF contains no extractable text (likely scanned image).",
                    )
                return ParseResult(
                    text="",
                    status="Failed: corrupt file",
                    error="PDF has no readable pages.",
                )
            return ParseResult(text=text, status="Parsed")

        if ext == ".docx":
            text = _extract_docx_text(data)
            if len(text.strip()) < 20:
                return ParseResult(
                    text="",
                    status="Failed: empty document",
                    error="DOCX contains no extractable text.",
                )
            return ParseResult(text=text, status="Parsed")

        if ext == ".txt":
            text = data.decode("utf-8", errors="replace").strip()
            if not text:
                return ParseResult(text="", status="Failed: empty file", error="Empty text file")
            return ParseResult(text=text, status="Parsed")

        return ParseResult(
            text="",
            status="Failed: unsupported format",
            error=f"Unsupported file extension: {ext}",
        )
    except Exception as exc:
        return ParseResult(
            text="",
            status="Failed: corrupt file",
            error=str(exc),
        )
