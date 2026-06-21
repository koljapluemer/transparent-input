import logging
import time

from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded
from django.utils.timezone import now

from .models import ProcessingJob
from .pipelines import get_pipeline_for_language

logger = logging.getLogger(__name__)


def _log(level, job, event, **extra):
    fields = f"job_id={job.id} video={job.video.youtube_id} pipeline={job.pipeline} event={event}"
    for k, v in extra.items():
        # Quote values that contain spaces so the line stays grep-friendly.
        fields += f' {k}="{v}"' if ' ' in str(v) else f' {k}={v}'
    getattr(logger, level)(fields)


@shared_task(soft_time_limit=600, time_limit=660)
def process_video(job_id: int):
    try:
        job = ProcessingJob.objects.select_related("video").get(id=job_id)
    except ProcessingJob.DoesNotExist:
        return

    # Atomic claim — bail if another worker already picked this up.
    if not ProcessingJob.objects.filter(id=job_id, status="pending").update(
        status="running", started_at=now()
    ):
        return

    _log('info', job, 'start')
    t0 = time.monotonic()

    try:
        pipeline = get_pipeline_for_language(job.pipeline)
        segments = pipeline.process(job.raw_transcript)
        job.video.segments = segments
        job.video.save(update_fields=["segments"])
        job.status = "done"
        job.finished_at = now()
        job.save(update_fields=["status", "finished_at"])
        _log('info', job, 'done', segments=len(segments), duration_ms=int((time.monotonic() - t0) * 1000))

    except SoftTimeLimitExceeded:
        job.status = "failed"
        job.error = "Processing timed out"
        job.finished_at = now()
        job.save(update_fields=["status", "error", "finished_at"])
        _log('error', job, 'timeout', duration_ms=int((time.monotonic() - t0) * 1000))

    except Exception as e:
        job.status = "failed"
        job.error = str(e)
        job.finished_at = now()
        job.save(update_fields=["status", "error", "finished_at"])
        _log('error', job, 'failed', error=str(e), duration_ms=int((time.monotonic() - t0) * 1000))
