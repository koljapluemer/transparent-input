from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('vocab', '0001_initial'),
    ]

    operations = [
        # Clear FK references to vocab_user before dropping it.
        # authtoken_token may exist if the project was previously run with authtoken installed.
        migrations.RunSQL(
            sql="DELETE FROM authtoken_token WHERE 1=1;",
            reverse_sql=migrations.RunSQL.noop,
        ),
        migrations.DeleteModel('WatchSession'),
        migrations.DeleteModel('Like'),
        migrations.DeleteModel('User'),
    ]
