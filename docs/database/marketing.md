# marketing

## next.design_template

```mermaid
erDiagram
"next.design_template" }o--o| "next.app_user" : ""
"next.design_template" }o--o| "next.app_user" : ""
"next.design_template" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.idea

```mermaid
erDiagram
"next.idea" }o--o| "next.app_user" : ""
"next.idea" }o--o| "next.app_user" : ""
"next.idea" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.platform_format

```mermaid
erDiagram
"next.platform_format"
```

## next.platform_metric

```mermaid
erDiagram
"next.platform_metric"
```

## next.post

```mermaid
erDiagram
"next.post" }o--o| "next.app_user" : ""
"next.post" }o--o| "next.app_user" : ""
"next.post" }o--o| "next.design_template" : ""
"next.post" }o--o| "next.idea" : ""
"next.post" }o--o| "next.job" : ""
"next.post" }o--|| "next.platform_format" : ""
"next.post" }o--|| "next.social_account" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (design_template_id) REFERENCES design_template(id)`
- `FOREIGN KEY (idea_id) REFERENCES idea(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (platform, format) REFERENCES platform_format(platform, format)`
- `FOREIGN KEY (social_account_id, platform) REFERENCES social_account(id, platform)`

## next.post_media

```mermaid
erDiagram
"next.post_media" }o--o| "next.app_user" : ""
"next.post_media" }o--o| "next.app_user" : ""
"next.post_media" }o--|| "next.document" : ""
"next.post_media" }o--o| "next.job" : ""
"next.post_media" }o--|| "next.post" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (document_id, content_type) REFERENCES document(id, content_type)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (post_id, format) REFERENCES post(id, format)`

## next.post_review

```mermaid
erDiagram
"next.post_review" }o--o| "next.app_user" : ""
"next.post_review" }o--o| "next.app_user" : ""
"next.post_review" }o--o| "next.job" : ""
"next.post_review" }o--|| "next.post" : ""
"next.post_review" |o--o| "next.post_text" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (post_id) REFERENCES post(id)`
- `FOREIGN KEY (post_id, text_version) REFERENCES post_text(post_id, version)`

## next.post_text

```mermaid
erDiagram
"next.post_text" }o--o| "next.app_user" : ""
"next.post_text" }o--o| "next.app_user" : ""
"next.post_text" }o--o| "next.job" : ""
"next.post_text" }o--|| "next.post" : ""
"next.post_text" }o--o| "next.post_text" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (post_id) REFERENCES post(id)`
- `FOREIGN KEY (post_id, previous_version) REFERENCES post_text(post_id, version)`

## next.social_account

```mermaid
erDiagram
"next.social_account" }o--o| "next.app_user" : ""
"next.social_account" }o--o| "next.app_user" : ""
"next.social_account" }o--o| "next.job" : ""
"next.social_account" }o--|| "next.party" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (owner_party_id) REFERENCES party(id)`

## next.social_sign_in

```mermaid
erDiagram
"next.social_sign_in" }o--|| "next.app_user" : ""
"next.social_sign_in" }o--|| "next.social_account" : ""
```

- `FOREIGN KEY (signed_in_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (social_account_id, platform_account_id) REFERENCES social_account(id, platform_account_id)`

## next.tour_plan

```mermaid
erDiagram
"next.tour_plan" }o--o| "next.activity" : ""
"next.tour_plan" }o--o| "next.activity_about" : ""
"next.tour_plan" }o--o| "next.app_user" : ""
"next.tour_plan" }o--o| "next.app_user" : ""
"next.tour_plan" }o--|| "next.deal" : ""
"next.tour_plan" }o--o| "next.job" : ""
```

- `FOREIGN KEY (completed_activity_id, completed_activity_kind) REFERENCES activity(id, kind)`
- `FOREIGN KEY (completed_activity_id, deal_id) REFERENCES activity_about(activity_id, deal_id) DEFERRABLE INITIALLY DEFERRED`
- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.tour_stop

```mermaid
erDiagram
"next.tour_stop" }o--o| "next.app_user" : ""
"next.tour_stop" }o--o| "next.app_user" : ""
"next.tour_stop" }o--o| "next.job" : ""
"next.tour_stop" }o--|| "next.property" : ""
"next.tour_stop" }o--|| "next.tour_plan" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (property_id) REFERENCES property(id)`
- `FOREIGN KEY (tour_plan_id) REFERENCES tour_plan(id)`
