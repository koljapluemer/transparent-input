from django.core.management.base import BaseCommand

import argostranslate.package


class Command(BaseCommand):
    help = "Download and install Argos Translate models for all languages in the DB."

    def handle(self, *args, **options):
        from vocab.models import Language

        # Derive Argos source code from the BCP-47 subtitle_language field (e.g. "vi-VN" → "vi").
        language_pairs = [
            (lang.subtitle_language.split("-")[0], "en", lang.human_readable)
            for lang in Language.objects.all()
        ]

        if not language_pairs:
            self.stdout.write("No languages found in DB — run migrations and seed data first.")
            return

        self.stdout.write("Fetching Argos package index…")
        argostranslate.package.update_package_index()
        available = argostranslate.package.get_available_packages()
        available_index = {(p.from_code, p.to_code): p for p in available}

        for from_code, to_code, label in language_pairs:
            pkg = available_index.get((from_code, to_code))
            if pkg is None:
                self.stderr.write(
                    self.style.WARNING(f"  ! no Argos model for {from_code}→{to_code} ({label})")
                )
                continue
            self.stdout.write(f"  installing {from_code}→{to_code} ({label})…")
            argostranslate.package.install_from_path(pkg.download())
            self.stdout.write(self.style.SUCCESS(f"  ✓ {label}"))
