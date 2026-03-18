"""
APA 7th Edition citation formatter.
Implements footnote and bibliography formats for books and articles.
"""


class APAFormatter:
    """
    APA 7th Edition citation formats.
    """

    # ==================== FOOTNOTE - BOOK ====================

    @staticmethod
    def footnote_book_first(
        author_last: str,
        author_first: str,
        title: str,
        publisher: str,
        year: str,
        page: str | None = None,
    ) -> str:
        """
        Book - First footnote reference.
        APA style: Author, A. A. (Year). Title. Publisher. p. X.
        """
        initials = _initials_from_first(author_first)
        parts = [f"{author_last}, {initials} ({year}). {_italicize(title)}. {publisher}."]
        if page:
            parts.append(f"p. {page}.")
        return " ".join(parts)

    @staticmethod
    def footnote_book_subsequent(
        author_last: str,
        year: str,
        page: str | None = None,
    ) -> str:
        """
        Book - Subsequent footnote reference.
        APA uses (Author, Year, p. X) for in-text but in footnotes: Author (Year), p. X.
        """
        base = f"{author_last} ({year})"
        if page:
            return f"{base}, p. {page}."
        return f"{base}."

    # ==================== FOOTNOTE - ARTICLE ====================

    @staticmethod
    def footnote_article_first(
        author_last: str,
        author_first: str,
        article_title: str,
        journal: str,
        volume: str,
        issue: str,
        year: str,
        page: str | None = None,
    ) -> str:
        """
        Article - First footnote reference.
        Author, A. A. (Year). Article title. Journal, Volume(Issue), page.
        """
        initials = _initials_from_first(author_first)
        base = (
            f"{author_last}, {initials} ({year}). {article_title}. "
            f"{_italicize(journal)}, {_italicize(volume)}({issue})"
        )
        if page:
            return f"{base}, {page}."
        return f"{base}."

    @staticmethod
    def footnote_article_subsequent(
        author_last: str,
        year: str,
        page: str | None = None,
    ) -> str:
        """Article - Subsequent footnote reference."""
        base = f"{author_last} ({year})"
        if page:
            return f"{base}, p. {page}."
        return f"{base}."

    # ==================== FOOTNOTE - CHAPTER IN EDITED BOOK ====================

    @staticmethod
    def footnote_chapter_first(
        author_last: str,
        author_first: str,
        chapter_title: str,
        editor_first: str,
        editor_last: str,
        book_title: str,
        publisher: str,
        year: str,
        pages: str,
    ) -> str:
        """Chapter in an edited book - First footnote reference."""
        author_initials = _initials_from_first(author_first)
        editor_initials = _initials_from_first(editor_first)
        return (
            f"{author_last}, {author_initials} ({year}). {chapter_title}. "
            f"In {editor_initials} {editor_last} (Ed.), "
            f"{_italicize(book_title)} (pp. {pages}). {publisher}."
        )

    # ==================== BIBLIOGRAPHY ====================

    @staticmethod
    def bibliography_book(
        author_last: str,
        author_first: str,
        title: str,
        publisher: str,
        year: str,
        edition: str | None = None,
    ) -> str:
        """
        Book - Bibliography/reference list entry.
        Author, A. A. (Year). Title (Xth ed.). Publisher.
        """
        initials = _initials_from_first(author_first)
        title_part = _italicize(title)
        if edition:
            title_part = f"{_italicize(title)} ({edition} ed.)"
        return f"{author_last}, {initials} ({year}). {title_part}. {publisher}."

    @staticmethod
    def bibliography_article(
        author_last: str,
        author_first: str,
        article_title: str,
        journal: str,
        volume: str,
        issue: str,
        year: str,
        page_range: str,
        doi: str | None = None,
    ) -> str:
        """
        Article - Bibliography/reference list entry.
        Author, A. A. (Year). Article title. Journal, Volume(Issue), pages. https://doi.org/xxx
        """
        initials = _initials_from_first(author_first)
        base = (
            f"{author_last}, {initials} ({year}). {article_title}. "
            f"{_italicize(journal)}, {_italicize(volume)}({issue}), {page_range}."
        )
        if doi:
            return f"{base} https://doi.org/{doi}"
        return base

    @staticmethod
    def bibliography_chapter(
        author_last: str,
        author_first: str,
        chapter_title: str,
        editor_first: str,
        editor_last: str,
        book_title: str,
        publisher: str,
        year: str,
        page_range: str,
    ) -> str:
        """Chapter in an edited book - Bibliography entry."""
        author_initials = _initials_from_first(author_first)
        editor_initials = _initials_from_first(editor_first)
        return (
            f"{author_last}, {author_initials} ({year}). {chapter_title}. "
            f"In {editor_initials} {editor_last} (Ed.), "
            f"{_italicize(book_title)} (pp. {page_range}). {publisher}."
        )

    @staticmethod
    def bibliography_website(
        author_last: str,
        author_first: str,
        page_title: str,
        site_name: str,
        year: str,
        url: str,
    ) -> str:
        """Website - Bibliography entry."""
        initials = _initials_from_first(author_first)
        return (
            f"{author_last}, {initials} ({year}). {_italicize(page_title)}. "
            f"{site_name}. {url}"
        )


# ==================== HELPERS ====================


def _initials_from_first(first_name: str) -> str:
    """
    Convert a first name (and optional middle names) to initials.
    'John Michael' -> 'J. M.'
    'J.' -> 'J.'
    """
    parts = first_name.strip().split()
    initials = []
    for part in parts:
        if part.endswith("."):
            initials.append(part)
        else:
            initials.append(f"{part[0]}.")
    return " ".join(initials)


def _italicize(text: str) -> str:
    """
    Return text as-is. In plain-text citation strings, italic markers are not
    embedded; the DOCX builder handles italic formatting when rendering.
    This placeholder exists so that callers can identify which parts would be
    italic in a rendered document.
    """
    return text
