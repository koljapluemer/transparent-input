import langcodes
from django.views.generic import ListView

from ..models import Video


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
