from django.shortcuts import get_object_or_404
from django.views.generic import ListView

from ..models import Language, Video


class VideoListView(ListView):
    template_name = "vocab/videos.html"
    context_object_name = "videos"

    def get_queryset(self):
        self.language = get_object_or_404(Language, iso3=self.kwargs["iso3"])
        return Video.objects.filter(language=self.language).order_by("title")

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx["language"] = self.language
        return ctx
