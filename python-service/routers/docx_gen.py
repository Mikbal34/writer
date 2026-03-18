"""
DOCX generation endpoint.
Accepts structured content and generates a Word document.
"""

import tempfile
import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from services.docx_builder import BookDocument

router = APIRouter()


class FontConfig(BaseModel):
    main: str = "Times New Roman"
    size_title: int = 16
    size_h1: int = 14
    size_h2: int = 12
    size_h3: int = 12
    size_h4: int = 12
    size_main: int = 12
    size_block_quote: int = 11
    size_footnote: int = 10
    size_bibliography: int = 11


class MarginConfig(BaseModel):
    top: float = 2.5
    bottom: float = 2.5
    left: float = 3.5
    right: float = 2.5


class FootnoteItem(BaseModel):
    """A footnote to attach to the preceding content element."""
    text: str


class ContentElement(BaseModel):
    """
    A single content element in the document.

    type can be one of:
      - "title": Main document title. Uses `text`.
      - "heading1" .. "heading4": Headings at levels 1-4. Uses `text`, optional `auto_number`.
      - "paragraph": Normal paragraph. Uses `text`, optional `first_indent`.
      - "paragraph_no_indent": Paragraph without first-line indent. Uses `text`.
      - "inline_quote": Inline quote. Uses `text_before`, `quote`, `text_after`.
      - "block_quote": Block quote. Uses `text`.
      - "translated_quote": Translated quote (italic). Uses `text_before`, `translation`, `text_after`.
      - "bibliography_title": Bibliography section header. No extra fields.
      - "bibliography_entry": Single bibliography entry. Uses `text`.
      - "page_break": Insert a page break. No extra fields.
    """
    type: str
    text: str = ""
    text_before: str = ""
    text_after: str = ""
    quote: str = ""
    translation: str = ""
    auto_number: bool = True
    first_indent: bool = True
    footnote: FootnoteItem | None = None


class GenerateDocxRequest(BaseModel):
    filename: str = "document"
    content: list[ContentElement]
    fonts: FontConfig = FontConfig()
    margins: MarginConfig = MarginConfig()
    line_spacing: float = 1.5
    bibliography_title: str = "BIBLIOGRAPHY"


class GenerateDocxResponse(BaseModel):
    message: str
    filename: str


@router.post("/generate-docx")
async def generate_docx(request: GenerateDocxRequest):
    """
    Generate a DOCX file from structured content elements.
    Returns the file as a download.
    """
    tmp_dir = tempfile.mkdtemp()
    try:
        doc = BookDocument(
            fonts={
                "main": request.fonts.main,
                "size_title": request.fonts.size_title,
                "size_h1": request.fonts.size_h1,
                "size_h2": request.fonts.size_h2,
                "size_h3": request.fonts.size_h3,
                "size_h4": request.fonts.size_h4,
                "size_main": request.fonts.size_main,
                "size_block_quote": request.fonts.size_block_quote,
                "size_footnote": request.fonts.size_footnote,
                "size_bibliography": request.fonts.size_bibliography,
            },
            margins={
                "top": request.margins.top,
                "bottom": request.margins.bottom,
                "left": request.margins.left,
                "right": request.margins.right,
            },
            line_spacing=request.line_spacing,
            output_dir=tmp_dir,
        )

        for element in request.content:
            p = _apply_element(doc, element, request.bibliography_title)
            if p is not None and element.footnote is not None:
                doc.add_footnote(p, element.footnote.text)

        filename = request.filename
        if not filename.endswith(".docx"):
            filename += ".docx"

        filepath = doc.save(filename)

        return FileResponse(
            path=filepath,
            filename=filename,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DOCX generation failed: {str(e)}")


def _apply_element(doc: BookDocument, el: ContentElement, bib_title: str):
    """
    Apply a single content element to the document. Returns the paragraph
    object (or None for non-paragraph elements like page_break).
    """
    t = el.type

    if t == "title":
        return doc.add_book_title(el.text)

    elif t == "heading1":
        return doc.add_heading_level1(el.text, auto_number=el.auto_number)

    elif t == "heading2":
        return doc.add_heading_level2(el.text, auto_number=el.auto_number)

    elif t == "heading3":
        return doc.add_heading_level3(el.text, auto_number=el.auto_number)

    elif t == "heading4":
        return doc.add_heading_level4(el.text, auto_number=el.auto_number)

    elif t == "paragraph":
        return doc.add_paragraph(el.text, first_indent=el.first_indent)

    elif t == "paragraph_no_indent":
        return doc.add_paragraph_no_indent(el.text)

    elif t == "inline_quote":
        return doc.add_inline_quote(el.text_before, el.quote, el.text_after)

    elif t == "block_quote":
        return doc.add_block_quote(el.text)

    elif t == "translated_quote":
        return doc.add_translated_quote(el.text_before, el.translation, el.text_after)

    elif t == "bibliography_title":
        return doc.add_bibliography_title(bib_title)

    elif t == "bibliography_entry":
        return doc.add_bibliography_entry(el.text)

    elif t == "page_break":
        doc.add_page_break()
        return None

    else:
        raise ValueError(f"Unknown content element type: {t}")
