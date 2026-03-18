"""
Chicago Manual of Style 17th Edition citation formatter.
Notes-Bibliography (NB) style.
"""


class ChicagoFormatter:
    """
    Chicago 17th Edition Notes-Bibliography style citation formats.
    """

    # ==================== FOOTNOTE - BOOK ====================

    @staticmethod
    def footnote_book_first(
        author_first: str,
        author_last: str,
        title: str,
        place: str,
        publisher: str,
        year: str,
        page: str | None = None,
    ) -> str:
        """
        Book - First footnote reference (full note).
        Format: First Last, Title (Place: Publisher, Year), page.
        """
        base = f"{author_first} {author_last}, {title} ({place}: {publisher}, {year})"
        if page:
            return f"{base}, {page}."
        return f"{base}."

    @staticmethod
    def footnote_book_subsequent(
        author_last: str,
        short_title: str,
        page: str | None = None,
    ) -> str:
        """
        Book - Subsequent footnote reference (short note).
        Format: Last, Short Title, page.
        """
        if page:
            return f"{author_last}, {short_title}, {page}."
        return f"{author_last}, {short_title}."

    # ==================== FOOTNOTE - ARTICLE ====================

    @staticmethod
    def footnote_article_first(
        author_first: str,
        author_last: str,
        article_title: str,
        journal: str,
        volume: str,
        issue: str,
        year: str,
        page: str | None = None,
    ) -> str:
        """
        Journal article - First footnote reference.
        Format: First Last, "Article Title," Journal Volume, no. Issue (Year): page.
        """
        base = (
            f'{author_first} {author_last}, "{article_title}," '
            f"{journal} {volume}, no. {issue} ({year})"
        )
        if page:
            return f"{base}: {page}."
        return f"{base}."

    @staticmethod
    def footnote_article_subsequent(
        author_last: str,
        short_title: str,
        page: str | None = None,
    ) -> str:
        """
        Article - Subsequent footnote reference.
        Format: Last, "Short Title," page.
        """
        if page:
            return f'{author_last}, "{short_title}," {page}.'
        return f'{author_last}, "{short_title}."'

    # ==================== FOOTNOTE - CHAPTER IN EDITED BOOK ====================

    @staticmethod
    def footnote_chapter_first(
        author_first: str,
        author_last: str,
        chapter_title: str,
        editor_first: str,
        editor_last: str,
        book_title: str,
        place: str,
        publisher: str,
        year: str,
        page: str | None = None,
    ) -> str:
        """
        Chapter in an edited book - First footnote reference.
        Format: First Last, "Chapter Title," in Book Title, ed. First Last
                (Place: Publisher, Year), page.
        """
        base = (
            f'{author_first} {author_last}, "{chapter_title}," in {book_title}, '
            f"ed. {editor_first} {editor_last} ({place}: {publisher}, {year})"
        )
        if page:
            return f"{base}, {page}."
        return f"{base}."

    # ==================== FOOTNOTE - TRANSLATED BOOK ====================

    @staticmethod
    def footnote_translation_first(
        author_first: str,
        author_last: str,
        title: str,
        translator: str,
        place: str,
        publisher: str,
        year: str,
        page: str | None = None,
    ) -> str:
        """
        Translated book - First footnote reference.
        Format: First Last, Title, trans. Translator (Place: Publisher, Year), page.
        """
        base = (
            f"{author_first} {author_last}, {title}, "
            f"trans. {translator} ({place}: {publisher}, {year})"
        )
        if page:
            return f"{base}, {page}."
        return f"{base}."

    # ==================== FOOTNOTE - EDITED/CRITICAL EDITION ====================

    @staticmethod
    def footnote_edited_first(
        author_first: str,
        author_last: str,
        title: str,
        editor: str,
        place: str,
        publisher: str,
        year: str,
        volume: str | None = None,
        page: str | None = None,
    ) -> str:
        """
        Edited/critical edition - First footnote reference.
        Format: First Last, Title, ed. Editor (Place: Publisher, Year), vol/page.
        """
        base = (
            f"{author_first} {author_last}, {title}, "
            f"ed. {editor} ({place}: {publisher}, {year})"
        )
        loc_parts = []
        if volume:
            loc_parts.append(volume)
        if page:
            loc_parts.append(page)

        if loc_parts:
            return f"{base}, {'/'.join(loc_parts)}."
        return f"{base}."

    # ==================== FOOTNOTE - SPECIAL ====================

    @staticmethod
    def footnote_ibid(page: str | None = None) -> str:
        """
        Ibid. reference (same source as immediately preceding footnote).
        Chicago allows Ibid. unlike ISNAD.
        """
        if page:
            return f"Ibid., {page}."
        return "Ibid."

    @staticmethod
    def footnote_see(reference: str) -> str:
        """General reference: 'See reference.'"""
        return f"See {reference}."

    @staticmethod
    def footnote_compare(reference: str) -> str:
        """Comparative reference: 'Cf. reference.'"""
        return f"Cf. {reference}."

    @staticmethod
    def footnote_cited_in(
        original_source: str,
        citing_source: str,
    ) -> str:
        """Secondary citation: 'Original, cited in Citing.'"""
        return f"{original_source}, cited in {citing_source}."

    # ==================== BIBLIOGRAPHY ====================

    @staticmethod
    def bibliography_book(
        author_last: str,
        author_first: str,
        title: str,
        place: str,
        publisher: str,
        year: str,
        edition: str | None = None,
    ) -> str:
        """
        Book - Bibliography entry.
        Format: Last, First. Title. Edition. Place: Publisher, Year.
        """
        parts = [f"{author_last}, {author_first}. {title}."]
        if edition:
            parts.append(f"{edition} ed.")
        parts.append(f"{place}: {publisher}, {year}.")
        return " ".join(parts)

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
        Journal article - Bibliography entry.
        Format: Last, First. "Article Title." Journal Volume, no. Issue (Year): pages.
        """
        base = (
            f'{author_last}, {author_first}. "{article_title}." '
            f"{journal} {volume}, no. {issue} ({year}): {page_range}."
        )
        if doi:
            return f"{base} https://doi.org/{doi}."
        return base

    @staticmethod
    def bibliography_chapter(
        author_last: str,
        author_first: str,
        chapter_title: str,
        editor_first: str,
        editor_last: str,
        book_title: str,
        place: str,
        publisher: str,
        year: str,
        page_range: str,
    ) -> str:
        """
        Chapter in edited book - Bibliography entry.
        Format: Last, First. "Chapter Title." In Book Title, edited by First Last,
                pages. Place: Publisher, Year.
        """
        return (
            f'{author_last}, {author_first}. "{chapter_title}." '
            f"In {book_title}, edited by {editor_first} {editor_last}, "
            f"{page_range}. {place}: {publisher}, {year}."
        )

    @staticmethod
    def bibliography_translation(
        author_last: str,
        author_first: str,
        title: str,
        translator: str,
        place: str,
        publisher: str,
        year: str,
    ) -> str:
        """
        Translated book - Bibliography entry.
        Format: Last, First. Title. Translated by Translator. Place: Publisher, Year.
        """
        return (
            f"{author_last}, {author_first}. {title}. "
            f"Translated by {translator}. {place}: {publisher}, {year}."
        )

    @staticmethod
    def bibliography_edited_edition(
        author_last: str,
        author_first: str,
        title: str,
        editor: str,
        place: str,
        publisher: str,
        year: str,
    ) -> str:
        """
        Edited/critical edition - Bibliography entry.
        Format: Last, First. Title. Edited by Editor. Place: Publisher, Year.
        """
        return (
            f"{author_last}, {author_first}. {title}. "
            f"Edited by {editor}. {place}: {publisher}, {year}."
        )

    @staticmethod
    def bibliography_website(
        author_last: str,
        author_first: str,
        page_title: str,
        site_name: str,
        date: str,
        url: str,
    ) -> str:
        """
        Website - Bibliography entry.
        Format: Last, First. "Page Title." Site Name. Date. URL.
        """
        return (
            f'{author_last}, {author_first}. "{page_title}." '
            f"{site_name}. {date}. {url}."
        )
