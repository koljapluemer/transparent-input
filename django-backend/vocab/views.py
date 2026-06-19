from rest_framework import viewsets, mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Language, Video, ProcessingJob
from .pipelines import get_pipeline_name_for_iso3, get_pipeline_for_language
from .serializers import LanguageSerializer, VideoListSerializer, VideoDetailSerializer


class LanguageViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = Language.objects.all()
    serializer_class = LanguageSerializer


class VideoViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Video.objects.select_related("language").all()
    lookup_field = "youtube_id"

    def get_serializer_class(self):
        if self.action == "retrieve":
            return VideoDetailSerializer
        return VideoListSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        language = self.request.query_params.get("language")
        if language:
            qs = qs.filter(language_id=language)
        return qs

    @action(detail=True, methods=["post"], url_path="submit")
    def submit(self, request, youtube_id=None):
        iso3 = request.data.get("language_iso3")
        transcript = request.data.get("transcript")

        if not iso3 or not isinstance(transcript, list):
            return Response(
                {"error": "language_iso3 and transcript are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            language = Language.objects.get(iso3=iso3)
        except Language.DoesNotExist:
            return Response(
                {"error": f"Unknown language: {iso3}"},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            pipeline_name = get_pipeline_name_for_iso3(iso3)
        except KeyError:
            return Response(
                {"error": f"No processing pipeline available for language: {iso3}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        video, _ = Video.objects.get_or_create(
            youtube_id=youtube_id,
            defaults={"language": language, "segments": []},
        )

        # Dedup: return existing job if already pending/running
        existing = ProcessingJob.objects.filter(
            video=video,
            pipeline=pipeline_name,
            status__in=["pending", "running"],
        ).first()
        if existing:
            return Response({"job_id": existing.id, "status": existing.status})

        job = ProcessingJob.objects.create(
            video=video,
            pipeline=pipeline_name,
            raw_transcript=transcript,
        )

        pipeline = get_pipeline_for_language(pipeline_name)
        from .tasks import process_video
        process_video.apply_async(args=[job.id], queue=pipeline.queue)

        return Response(
            {"job_id": job.id, "status": job.status},
            status=status.HTTP_202_ACCEPTED,
        )
