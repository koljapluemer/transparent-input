import langcodes
from django.views.generic import TemplateView

from ..models import Video


class LandingView(TemplateView):
    template_name = "vocab/landing.html"


class LanguageSelectView(TemplateView):
    template_name = "vocab/language-select.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        codes = (
            Video.objects
            .exclude(language__isnull=True)
            .exclude(language='')
            .values_list('language', flat=True)
            .distinct()
            .order_by('language')
        )
        ctx["languages"] = [
            {"code": code, "human_readable": langcodes.get(code).display_name('en')}
            for code in codes
        ]
        return ctx
