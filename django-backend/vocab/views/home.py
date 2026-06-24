from django.views.generic import TemplateView

from ..models import Language


class HomeView(TemplateView):
    template_name = "vocab/home.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx["languages"] = Language.objects.all()
        return ctx
