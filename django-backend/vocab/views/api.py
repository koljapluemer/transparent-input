from rest_framework import viewsets, mixins, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import Language, Like, Video, VideoTranslation, ProcessingJob
from ..pipelines import get_pipeline_name_for_iso3, get_pipeline_for_language
from ..serializers import (
    LanguageSerializer,
    VideoListSerializer,
    VideoDetailSerializer,
    VideoTranslationDetailSerializer,
)


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
        title = request.data.get("title") or None

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

        video, created = Video.objects.get_or_create(
            youtube_id=youtube_id,
            defaults={"language": language, "segments": [], "title": title},
        )
        if not created and title and not video.title:
            video.title = title
            video.save(update_fields=["title"])

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
        from ..tasks import process_video
        process_video.apply_async(args=[job.id], queue=pipeline.queue)

        return Response(
            {"job_id": job.id, "status": job.status},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["post"], url_path="translations")
    def store_translation(self, request, youtube_id=None):
        pipeline = request.data.get("pipeline")
        native_language = request.data.get("native_language")
        segments = request.data.get("segments")

        if not pipeline or not native_language or not isinstance(segments, list):
            return Response(
                {"error": "pipeline, native_language, and segments (list) are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        video = self.get_object()
        _, created = VideoTranslation.objects.update_or_create(
            video=video,
            pipeline=pipeline,
            native_language=native_language,
            defaults={"segments": segments},
        )

        return Response(
            {"status": "stored" if created else "updated"},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=["get"],
        url_path=r"translations/(?P<native_language>[^/.]+)",
    )
    def translation_detail(self, request, youtube_id=None, native_language=None):
        video = self.get_object()
        try:
            translation = VideoTranslation.objects.get(
                video=video,
                native_language=native_language,
            )
        except VideoTranslation.DoesNotExist:
            return Response(
                {"error": f"No translation found for language: {native_language}"},
                status=status.HTTP_404_NOT_FOUND,
            )
        except VideoTranslation.MultipleObjectsReturned:
            translation = VideoTranslation.objects.filter(
                video=video,
                native_language=native_language,
            ).order_by("-created_at").first()

        return Response(VideoTranslationDetailSerializer(translation).data)

    @action(detail=True, methods=["post", "delete"], url_path="like", permission_classes=[IsAuthenticated])
    def like(self, request, youtube_id=None):
        video = self.get_object()
        if request.method == "POST":
            Like.objects.get_or_create(user=request.user, video=video)
            return Response({"liked": True}, status=status.HTTP_200_OK)
        Like.objects.filter(user=request.user, video=video).delete()
        return Response({"liked": False}, status=status.HTTP_200_OK)
