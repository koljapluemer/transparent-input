from celery import shared_task
from django.utils.timezone import now
from .models import ProcessingJob
from .pipelines import get_pipeline_for_language


@shared_task
def process_video(job_id: int):
    try:
        job = ProcessingJob.objects.select_related("video").get(id=job_id)
    except ProcessingJob.DoesNotExist:
        return

    # atomic claim — bail if another worker already picked this up
    if not ProcessingJob.objects.filter(id=job_id, status="pending").update(
        status="running", started_at=now()
    ):
        return

    try:
        pipeline = get_pipeline_for_language(job.pipeline)
        segments = pipeline.process(job.raw_transcript)
        job.video.segments = segments
        job.video.save(update_fields=["segments"])
        job.status = "done"
        job.finished_at = now()
        job.save(update_fields=["status", "finished_at"])
    except Exception as e:
        job.status = "failed"
        job.error = str(e)
        job.finished_at = now()
        job.save(update_fields=["status", "error", "finished_at"])
