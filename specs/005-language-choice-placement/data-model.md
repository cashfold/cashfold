# Data Model: Language Choice Only Where It Belongs

No change. The `language` preference (`auto | en | uk | pl`, device-local, in the `cashfold.ui` preferences object) and its rules are exactly those of spec 004 ([data-model](../004-ukrainian-polish-languages/data-model.md)). Only the places that can change it are fewer.

| Surface | Reads the choice | Can change it |
|---------|------------------|---------------|
| Home, unlock/sign-in, recover, add-device pages | yes | no |
| Sign-up page (form step) | yes | **yes** |
| Secret Key step after sign-up | yes | no |
| Signed-in screens other than Settings → Appearance | yes | no |
| Settings → Appearance | yes | **yes** |
