Let's straighten out the sloppy handling of translation states, especially in the browser-plugin (but django-backend is affected, too)

First of all, the `VideoTranslation` model should have a bool checkedByHuman, default false (this will be later integrated in a crm flow for a human mod to check whether a translation has gone smoothly).

Also, add a field `level` with an enum (use django best practices), with values `INTERMEDIATE` (default), `EXPERT` and `BEGINNER`.

Next, on the plugin options, the language UI should work as follows:
One smart dropdown-text input to add languages.

Below that, a list of the added languages.
With an icon button to remove them again, and a star icon button to set a language as 'Main Language'. As a default, English is set in this list, and set as Main Language. selecting a new language as main language automatically unsets the previous main language. removing the entry that's the current main means setting the main lang to the first in the list. 

Now, in context of the main toolbar, there can be the following states:

1. There are no translations into any of the user's native languages available
2. There are some relevant translations into any of the user's native languages available
3. Processing ongoing

These can be combined w/ one of the two states:

a) API key is setup
b) API key is not setup

Here is how the toolbar should handle these:

1b)
Show: "Vocabulary for this video has not been processed. To request it, <a>setup your AI API key</a>, then refresh."

1a)
Show: Extract vocabulary from $language_dropdown_with_available_subtitle_tracks with translations in $language_dropdown_with_user_native_langs_and_main_language_preselected for level $dropdown_intermediate_expert_beginner

Depending on the selected level, instruct the AI either to instruct only simple, extremely common, visually clear (e.g. concrete nouns, actions verbs, adjectives) vocabulary (Beginner), use prompt we use right now (Intermediate) or only advanced, likely unknown and topic-specific vocab (Expert)

Confirmation button leads to state 3

2a)
Show:
"Showing $dropdown_with_available_video_translations_1d_lisit_with_translation_languages_filtered_to_user_native_langs_and_levels" and of course on the video, show the vocab overlay, as is done now.
Selecting another from this dropdown should request and switch the VideoTranslation accordingly.
Also show a link "Request a new translation", which basically leads to 1a), just with a `back` link leading back to 2a (model this well!)

2b)
As above, only instead of the "Request a new translation" show a link to options with "To request another translation, setup your API key"

3)
Should show the process, with an "Abort" button.
Think about whether we couldn't actually start showing the vocab overlay, as soon as the data for the current segment is processed, instead of waiting for the very end of the whole thing, as we do now. 