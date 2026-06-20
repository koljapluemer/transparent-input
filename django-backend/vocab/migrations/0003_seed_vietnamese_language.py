from django.db import migrations


def seed(apps, schema_editor):
    Language = apps.get_model("vocab", "Language")
    Language.objects.get_or_create(
        iso3="vie",
        defaults={"subtitle_language": "vi", "human_readable": "Vietnamese"},
    )


def unseed(apps, schema_editor):
    Language = apps.get_model("vocab", "Language")
    Language.objects.filter(iso3="vie").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("vocab", "0002_alter_video_segments_processingjob"),
    ]
    operations = [
        migrations.RunPython(seed, reverse_code=unseed),
    ]
