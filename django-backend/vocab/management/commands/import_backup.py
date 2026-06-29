import json
from django.core.management.base import BaseCommand, CommandError
from vocab.models import Video, VideoTranslation


class Command(BaseCommand):
    help = "Import videos and translations from vocab_backup.json into the current schema"

    def add_arguments(self, parser):
        parser.add_argument("backup_file", nargs="?", default="vocab_backup.json")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        path = options["backup_file"]
        dry_run = options["dry_run"]

        try:
            with open(path) as f:
                records = json.load(f)
        except FileNotFoundError:
            raise CommandError(f"File not found: {path}")

        # Index records by model
        videos_raw = {r["pk"]: r["fields"] for r in records if r["model"] == "vocab.video"}
        jobs_raw = [r["fields"] for r in records if r["model"] == "vocab.processingjob"]

        # Map ISO 639-3 pk -> BCP 47 subtitle_language code
        lang_to_bcp47 = {
            r["pk"]: r["fields"]["subtitle_language"]
            for r in records
            if r["model"] == "vocab.language"
        }

        # Build a map: video pk -> pipeline (prefer "done" status jobs)
        pipeline_by_video = {}
        for job in jobs_raw:
            vid_pk = job["video"]
            if job["status"] == "done" or vid_pk not in pipeline_by_video:
                pipeline_by_video[vid_pk] = job["pipeline"]

        videos_created = videos_skipped = translations_created = translations_skipped = 0

        for pk, fields in videos_raw.items():
            language = lang_to_bcp47.get(fields.get("language"), fields.get("language"))
            if not dry_run:
                video, created = Video.objects.get_or_create(
                    youtube_id=fields["youtube_id"],
                    defaults={
                        "title": fields.get("title"),
                        "language": language,
                    },
                )
            else:
                created = not Video.objects.filter(youtube_id=fields["youtube_id"]).exists()
                video = None

            if created:
                videos_created += 1
            else:
                videos_skipped += 1

            segments = fields.get("segments")
            if not segments:
                continue

            pipeline = pipeline_by_video.get(pk, "legacy")

            if dry_run:
                translations_created += 1
                continue

            _, trans_created = VideoTranslation.objects.get_or_create(
                video=video,
                pipeline=pipeline,
                native_language="en",
                level=VideoTranslation.Level.INTERMEDIATE,
                defaults={"segments": segments},
            )
            if trans_created:
                translations_created += 1
            else:
                translations_skipped += 1

        prefix = "[dry-run] " if dry_run else ""
        self.stdout.write(
            f"{prefix}Videos: {videos_created} created, {videos_skipped} already existed\n"
            f"{prefix}Translations: {translations_created} created, {translations_skipped} already existed"
        )
