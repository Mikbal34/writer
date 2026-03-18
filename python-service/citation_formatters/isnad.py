"""
ISNAD 2nd Edition v1.6 citation formatter.
Ported directly from TezDocument's ISNADFormatter.

Uses short title for subsequent references (age/agm NOT used).
"""


class ISNADFormatter:
    """
    ISNAD 2nd Edition v1.6 citation formats.
    Short titles used for subsequent references instead of age/agm.
    """

    # ==================== FOOTNOTE - BOOK ====================

    @staticmethod
    def dipnot_kitap_ilk(
        yazar_soyad: str,
        yazar_ad: str,
        kitap_adi: str,
        basim_yeri: str | None = None,
        yayinevi: str | None = None,
        yil: str | None = None,
        sayfa: str | None = None,
        cilt: str | None = None,
    ) -> str:
        """Book - First footnote reference (full citation)."""
        parts = [f"{yazar_soyad}, {yazar_ad}. {kitap_adi}."]

        if basim_yeri and yayinevi:
            parts.append(f"{basim_yeri}: {yayinevi},")
        elif yayinevi:
            parts.append(f"{yayinevi},")

        if yil:
            parts.append(f"{yil},")

        if cilt and sayfa:
            parts.append(f"{cilt}/{sayfa}.")
        elif sayfa:
            parts.append(f"{sayfa}.")

        return " ".join(parts)

    @staticmethod
    def dipnot_kitap_sonraki(
        yazar_soyad: str,
        kisa_baslik: str,
        sayfa: str,
        cilt: str | None = None,
    ) -> str:
        """Book - Subsequent footnote reference (short citation). No age!"""
        if cilt:
            return f"{yazar_soyad}, {kisa_baslik}, {cilt}/{sayfa}."
        return f"{yazar_soyad}, {kisa_baslik}, {sayfa}."

    @staticmethod
    def dipnot_iki_yazar(
        soyad1: str,
        soyad2: str,
        kisa_baslik: str,
        sayfa: str,
        cilt: str | None = None,
    ) -> str:
        """Two-author book - Footnote."""
        if cilt:
            return f"{soyad1} - {soyad2}, {kisa_baslik}, {cilt}/{sayfa}."
        return f"{soyad1} - {soyad2}, {kisa_baslik}, {sayfa}."

    # ==================== FOOTNOTE - EDITED/CRITICAL EDITION ====================

    @staticmethod
    def dipnot_nesir_ilk(
        musannif_soyad: str,
        musannif_ad: str,
        kitap_adi: str,
        nasir: str,
        basim_yeri: str,
        yayinevi: str,
        yil: str,
        cilt: str,
        sayfa: str,
    ) -> str:
        """Edited/critical edition - First footnote reference."""
        return (
            f"{musannif_soyad}, {musannif_ad}. {kitap_adi}. "
            f"nsr. {nasir}. {basim_yeri}: {yayinevi}, {yil}, {cilt}/{sayfa}."
        )

    # ==================== FOOTNOTE - TRANSLATION ====================

    @staticmethod
    def dipnot_ceviri_ilk(
        yazar_soyad: str,
        yazar_ad: str,
        kitap_adi: str,
        cevirmen: str,
        basim_yeri: str,
        yayinevi: str,
        yil: str,
        sayfa: str,
    ) -> str:
        """Translated book - First footnote reference."""
        return (
            f"{yazar_soyad}, {yazar_ad}. {kitap_adi}. "
            f"cev. {cevirmen}. {basim_yeri}: {yayinevi}, {yil}, {sayfa}."
        )

    # ==================== FOOTNOTE - ARTICLE ====================

    @staticmethod
    def dipnot_makale_ilk(
        yazar_soyad: str,
        yazar_ad: str,
        makale_adi: str,
        dergi_adi: str,
        cilt: str,
        sayi: str,
        yil: str,
        sayfa: str,
    ) -> str:
        """Article - First footnote reference."""
        return (
            f'{yazar_soyad}, {yazar_ad}. "{makale_adi}". '
            f"{dergi_adi} {cilt}/{sayi} ({yil}), {sayfa}."
        )

    @staticmethod
    def dipnot_makale_sonraki(
        yazar_soyad: str,
        kisa_baslik: str,
        sayfa: str,
    ) -> str:
        """Article - Subsequent footnote reference."""
        return f'{yazar_soyad}, "{kisa_baslik}", {sayfa}.'

    # ==================== FOOTNOTE - SPECIAL ====================

    @staticmethod
    def dipnot_aktarim(asil_kaynak: str, aktaran_kaynak: str) -> str:
        """Secondary citation. Uses 'akt.' prefix."""
        return f"{asil_kaynak} akt. {aktaran_kaynak}"

    @staticmethod
    def dipnot_bk(kaynak: str) -> str:
        """General reference to entire work."""
        return f"bk. {kaynak}"

    @staticmethod
    def dipnot_krs(kaynak: str) -> str:
        """Comparative reference."""
        return f"krs. {kaynak}"

    # ==================== BIBLIOGRAPHY ====================

    @staticmethod
    def kaynakca_kitap(
        yazar_soyad: str,
        yazar_ad: str,
        kitap_adi: str,
        basim_yeri: str | None = None,
        yayinevi: str | None = None,
        basim: str | None = None,
        yil: str | None = None,
    ) -> str:
        """Book - Bibliography entry."""
        parts = [f"{yazar_soyad}, {yazar_ad}. {kitap_adi}."]

        if basim_yeri and yayinevi:
            parts.append(f"{basim_yeri}: {yayinevi},")
        elif yayinevi:
            parts.append(f"{yayinevi},")

        if basim:
            parts.append(f"{basim}. Basim,")

        if yil:
            parts.append(f"{yil}.")

        return " ".join(parts)

    @staticmethod
    def kaynakca_makale(
        yazar_soyad: str,
        yazar_ad: str,
        makale_adi: str,
        dergi_adi: str,
        cilt: str,
        sayi: str,
        yil: str,
        sayfa_aralik: str,
    ) -> str:
        """Article - Bibliography entry. Page range is required."""
        return (
            f'{yazar_soyad}, {yazar_ad}. "{makale_adi}". '
            f"{dergi_adi} {cilt}/{sayi} ({yil}): {sayfa_aralik}."
        )

    @staticmethod
    def kaynakca_nesir(
        musannif_soyad: str,
        musannif_ad: str,
        kitap_adi: str,
        nasir: str,
        basim_yeri: str,
        yayinevi: str,
        yil: str,
    ) -> str:
        """Edited/critical edition - Bibliography entry."""
        return (
            f"{musannif_soyad}, {musannif_ad}. {kitap_adi}. "
            f"nsr. {nasir}. {basim_yeri}: {yayinevi}, {yil}."
        )

    @staticmethod
    def kaynakca_ceviri(
        yazar_soyad: str,
        yazar_ad: str,
        kitap_adi: str,
        cevirmen: str,
        basim_yeri: str,
        yayinevi: str,
        yil: str,
    ) -> str:
        """Translated book - Bibliography entry."""
        return (
            f"{yazar_soyad}, {yazar_ad}. {kitap_adi}. "
            f"cev. {cevirmen}. {basim_yeri}: {yayinevi}, {yil}."
        )
