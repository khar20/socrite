from io import BytesIO

from docx import Document
from pptx import Presentation
from pypdf import PdfReader


def extract_pages(filename: str, body: bytes) -> list[tuple[int, str]]:
    extension = filename.rsplit(".", 1)[-1].casefold()
    stream = BytesIO(body)
    if extension == "pdf":
        return [(index, page.extract_text() or "") for index, page in enumerate(PdfReader(stream).pages, 1)]
    if extension == "docx":
        document = Document(stream)
        text = "\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text.strip())
        return [(1, text)]
    if extension == "pptx":
        presentation = Presentation(stream)
        return [(index, "\n".join(shape.text for shape in slide.shapes if getattr(shape, "has_text_frame", False)))
                for index, slide in enumerate(presentation.slides, 1)]
    if extension == "txt":
        return [(1, body.decode("utf-8-sig"))]
    raise ValueError("Unsupported file format")


def chunk_pages(pages: list[tuple[int, str]], max_chars: int = 3500) -> list[tuple[int | None, str]]:
    if max_chars < 1:
        raise ValueError("max_chars must be positive")
    overlap = min(160, max_chars // 10)
    chunks = []
    for page_number, text in pages:
        clean = " ".join(text.split())
        if not clean:
            continue
        while clean:
            boundary = min(max_chars, len(clean))
            if boundary < len(clean):
                split_at = clean.rfind(" ", 0, boundary)
                if split_at > max_chars // 2:
                    boundary = split_at
            chunks.append((page_number, clean[:boundary].strip()))
            clean = clean[max(0, boundary - overlap):].strip() if boundary < len(clean) else ""
    return chunks
