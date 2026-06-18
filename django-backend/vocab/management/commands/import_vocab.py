import json
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from vocab.models import Language, Video


class Command(BaseCommand):
    help = "Import vocab data from 2_export directory into the database"

    def add_arguments(self, parser):
        parser.add_argument("export_dir", type=Path, help="Path to the 2_export directory")

    def handle(self, *args, **options):
        export_dir = options["export_dir"]
        if not export_dir.is_dir():
            raise CommandError(f"{export_dir} is not a directory")

        created_videos = 0
        updated_videos = 0

        for lang_dir in sorted(export_dir.iterdir()):
            if not lang_dir.is_dir():
                continue

            for json_file in sorted(lang_dir.glob("*.json")):
                if json_file.stem.startswith("_"):
                    continue

                data = json.loads(json_file.read_text())

                lang_data = data["language"]
                language, _ = Language.objects.get_or_create(
                    iso3=lang_data["iso3"],
                    defaults={
                        "subtitle_language": lang_data["subtitleLanguage"],
                        "human_readable": lang_data["humanReadable"],
                    },
                )

                _, created = Video.objects.update_or_create(
                    youtube_id=data["videoId"],
                    defaults={
                        "language": language,
                        "segments": data["segments"],
                        "topics": data.get("topics"),
                    },
                )

                if created:
                    created_videos += 1
                else:
                    updated_videos += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Done: {created_videos} created, {updated_videos} updated"
            )
        )
