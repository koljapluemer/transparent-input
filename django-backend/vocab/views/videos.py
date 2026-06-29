import json

import langcodes
from django.shortcuts import get_object_or_404, render
from django.views import View
from django.views.generic import ListView

from ..models import Video, VideoTranslation


class VideoListView(ListView):
    template_name = "vocab/videos.html"
    context_object_name = "videos"

    def get_queryset(self):
        self.language_code = self.kwargs["language"]
        return Video.objects.filter(language=self.language_code).order_by("title")

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx["language"] = {
            "code": self.language_code,
            "human_readable": langcodes.get(self.language_code).display_name('en'),
        }
        return ctx


class VideoPlayerView(View):
    def get(self, request, language, youtube_id):
        video = get_object_or_404(Video, youtube_id=youtube_id)
        available = list(
            video.translations.values("native_language", "level").distinct()
        )
        translation = (
            video.translations
            .filter(native_language="en", level=VideoTranslation.Level.INTERMEDIATE)
            .first()
            or video.translations.order_by("-created_at").first()
        )
        origin = request.build_absolute_uri('/').rstrip('/')
        return render(request, "vocab/video-player.html", {
            "video": video,
            "language_code": language,
            "language_human": langcodes.get(language).display_name('en'),
            "initial_segments_json": json.dumps(translation.segments if translation else []),
            "available_translations_json": json.dumps(available),
            "initial_native_lang": translation.native_language if translation else "",
            "initial_level": translation.level if translation else "INTERMEDIATE",
            "origin": origin,
        })
