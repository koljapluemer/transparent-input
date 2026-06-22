import json
from datetime import date, timedelta

from django.contrib.auth import login, get_user_model
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.mixins import LoginRequiredMixin
from django.db.models import Sum
from django.db.models.functions import TruncDate
from django.urls import reverse_lazy
from django.views.generic import FormView, TemplateView

from ..models import Language, Like, WatchSession


class CustomUserCreationForm(UserCreationForm):
    class Meta(UserCreationForm.Meta):
        model = get_user_model()
        fields = ("email",)


class HomeView(TemplateView):
    template_name = "vocab/home.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx["languages"] = Language.objects.all()
        return ctx


class RegisterPageView(FormView):
    template_name = "vocab/register.html"
    form_class = CustomUserCreationForm
    success_url = reverse_lazy("profile")

    def form_valid(self, form):
        user = form.save()
        login(self.request, user)
        return super().form_valid(form)


class ProfilePageView(LoginRequiredMixin, TemplateView):
    template_name = "vocab/profile.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        user = self.request.user

        ctx["token"] = user.auth_token.key

        ctx["liked_videos"] = (
            Like.objects.filter(user=user)
            .select_related("video", "video__language")
            .order_by("-created_at")
        )

        # Daily watch time for the last 30 days in minutes
        since = date.today() - timedelta(days=29)
        rows = (
            WatchSession.objects.filter(user=user, date__gte=since)
            .values("date")
            .annotate(total_seconds=Sum("seconds_watched"))
            .order_by("date")
        )
        by_date = {r["date"].isoformat(): r["total_seconds"] for r in rows}
        # Fill all 30 days so the chart has a continuous x-axis
        chart_labels = []
        chart_data = []
        for i in range(30):
            d = (since + timedelta(days=i)).isoformat()
            chart_labels.append(d)
            chart_data.append(round(by_date.get(d, 0) / 60, 1))

        ctx["chart_labels"] = json.dumps(chart_labels)
        ctx["chart_data"] = json.dumps(chart_data)
        ctx["has_watch_data"] = any(v > 0 for v in chart_data)
        return ctx
