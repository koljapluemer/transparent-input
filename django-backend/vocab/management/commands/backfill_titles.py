from django.core.management.base import BaseCommand
from vocab.models import Video


class Command(BaseCommand):
    help = "Backfill Video.title for NULL rows using yt-dlp"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--limit", type=int, default=None)

    def handle(self, *args, **options):
        import yt_dlp

        ydl_opts = {"quiet": True, "skip_download": True, "no_warnings": True}
        qs = Video.objects.filter(title__isnull=True)
        if options["limit"]:
            qs = qs[: options["limit"]]

        self.stdout.write(f"Found {qs.count()} videos with no title")

        updated = failed = 0
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            for video in qs:
                url = f"https://www.youtube.com/watch?v={video.youtube_id}"
                try:
                    info = ydl.extract_info(url, download=False)
                    title = info.get("title")
                    if not title:
                        self.stderr.write(self.style.WARNING(f"  no title: {video.youtube_id}"))
                        failed += 1
                        continue
                    if options["dry_run"]:
                        self.stdout.write(f"  [dry-run] {video.youtube_id}: {title}")
                    else:
                        video.title = title
                        video.save(update_fields=["title"])
                        self.stdout.write(f"  {video.youtube_id}: {title}")
                    updated += 1
                except Exception as exc:
                    self.stderr.write(self.style.WARNING(f"  failed {video.youtube_id}: {exc}"))
                    failed += 1

        self.stdout.write(self.style.SUCCESS(f"Done: {updated} updated, {failed} failed"))
