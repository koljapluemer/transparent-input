from django.contrib.auth import authenticate
from django.db.models import F, Sum
from django.db.models.functions import TruncDate
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import User, Video, WatchSession


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get("email", "").strip()
        password = request.data.get("password", "")
        if not email or not password:
            return Response(
                {"error": "email and password are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if User.objects.filter(email=email).exists():
            return Response(
                {"error": "email already registered"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = User.objects.create_user(email=email, password=password)
        return Response(
            {"token": user.auth_token.key, "email": user.email},
            status=status.HTTP_201_CREATED,
        )


class ObtainTokenView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get("email", "")
        password = request.data.get("password", "")
        user = authenticate(request, email=email, password=password)
        if user is None:
            return Response(
                {"error": "invalid credentials"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        return Response({"token": user.auth_token.key, "email": user.email})


class ProfileAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "email": request.user.email,
            "token": request.user.auth_token.key,
        })


class WatchSessionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        sessions = request.data.get("sessions", [])
        if not isinstance(sessions, list):
            return Response({"error": "sessions must be a list"}, status=status.HTTP_400_BAD_REQUEST)

        errors = []
        saved = 0
        for item in sessions:
            video_id = item.get("video_id")
            seconds = item.get("seconds")
            date_str = item.get("date")
            date = parse_date(date_str) if date_str else None

            if not video_id or not isinstance(seconds, int) or seconds <= 0 or not date:
                errors.append(item)
                continue

            try:
                video = Video.objects.get(youtube_id=video_id)
            except Video.DoesNotExist:
                errors.append(item)
                continue

            obj, created = WatchSession.objects.get_or_create(
                user=request.user,
                video=video,
                date=date,
                defaults={"seconds_watched": seconds},
            )
            if not created:
                WatchSession.objects.filter(pk=obj.pk).update(
                    seconds_watched=F("seconds_watched") + seconds
                )
            saved += 1

        return Response({"saved": saved, "errors": len(errors)}, status=status.HTTP_200_OK)
