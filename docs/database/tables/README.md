# postgres

## Viewpoints

| Name                                                        | Description                                            |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| [People](viewpoint-people.md)                               | Tables in this area and the foreign keys between them. |
| [Relationships](viewpoint-relationships.md)                 | Tables in this area and the foreign keys between them. |
| [Clients](viewpoint-clients.md)                             | Tables in this area and the foreign keys between them. |
| [Vendors and territories](viewpoint-vendors-territories.md) | Tables in this area and the foreign keys between them. |
| [Deals](viewpoint-deals.md)                                 | Tables in this area and the foreign keys between them. |
| [Imported deals](viewpoint-imported-deals.md)               | Tables in this area and the foreign keys between them. |
| [Property](viewpoint-property.md)                           | Tables in this area and the foreign keys between them. |
| [Leases](viewpoint-leases.md)                               | Tables in this area and the foreign keys between them. |
| [Offers](viewpoint-offers.md)                               | Tables in this area and the foreign keys between them. |
| [Commissions](viewpoint-commissions.md)                     | Tables in this area and the foreign keys between them. |
| [Documents](viewpoint-documents.md)                         | Tables in this area and the foreign keys between them. |
| [Email](viewpoint-email.md)                                 | Tables in this area and the foreign keys between them. |
| [Leads](viewpoint-leads.md)                                 | Tables in this area and the foreign keys between them. |
| [Activity](viewpoint-activity.md)                           | Tables in this area and the foreign keys between them. |
| [Home and calendar](viewpoint-home-calendar.md)             | Tables in this area and the foreign keys between them. |
| [Doc](viewpoint-doc.md)                                     | Tables in this area and the foreign keys between them. |
| [Invoices](viewpoint-invoices.md)                           | Tables in this area and the foreign keys between them. |
| [Marketing posts](viewpoint-marketing-posts.md)             | Tables in this area and the foreign keys between them. |
| [Marketing categories](viewpoint-marketing-categories.md)   | Tables in this area and the foreign keys between them. |
| [Marketing review](viewpoint-marketing-review.md)           | Tables in this area and the foreign keys between them. |
| [Social accounts](viewpoint-social-accounts.md)             | Tables in this area and the foreign keys between them. |
| [Tours](viewpoint-tours.md)                                 | Tables in this area and the foreign keys between them. |
| [Client websites](viewpoint-website.md)                     | Tables in this area and the foreign keys between them. |
| [Users and jobs](viewpoint-users-jobs.md)                   | Tables in this area and the foreign keys between them. |
| [Changes and preferences](viewpoint-changes-preferences.md) | Tables in this area and the foreign keys between them. |

## Tables

| Name                                                                                        | Columns | Comment | Type       |
| ------------------------------------------------------------------------------------------- | ------- | ------- | ---------- |
| [next.active_do_not_contact](next.active_do_not_contact.md)                                 | 4       |         | VIEW       |
| [next.activity](next.activity.md)                                                           | 13      |         | BASE TABLE |
| [next.activity_about](next.activity_about.md)                                               | 9       |         | BASE TABLE |
| [next.app_user](next.app_user.md)                                                           | 5       |         | BASE TABLE |
| [next.building_ownership](next.building_ownership.md)                                       | 12      |         | BASE TABLE |
| [next.calendar_agenda](next.calendar_agenda.md)                                             | 7       |         | BASE TABLE |
| [next.calendar_review_dismissal](next.calendar_review_dismissal.md)                         | 7       |         | BASE TABLE |
| [next.candidate](next.candidate.md)                                                         | 17      |         | BASE TABLE |
| [next.change](next.change.md)                                                               | 11      |         | BASE TABLE |
| [next.claim_type](next.claim_type.md)                                                       | 6       |         | BASE TABLE |
| [next.client](next.client.md)                                                               | 10      |         | BASE TABLE |
| [next.client_brand](next.client_brand.md)                                                   | 11      |         | BASE TABLE |
| [next.client_research](next.client_research.md)                                             | 12      |         | BASE TABLE |
| [next.client_research_fact](next.client_research_fact.md)                                   | 7       |         | BASE TABLE |
| [next.client_status](next.client_status.md)                                                 | 2       |         | VIEW       |
| [next.client_type](next.client_type.md)                                                     | 6       |         | BASE TABLE |
| [next.client_vertical](next.client_vertical.md)                                             | 9       |         | BASE TABLE |
| [next.commission](next.commission.md)                                                       | 9       |         | BASE TABLE |
| [next.commission_payment](next.commission_payment.md)                                       | 11      |         | BASE TABLE |
| [next.commission_share](next.commission_share.md)                                           | 10      |         | BASE TABLE |
| [next.commission_split](next.commission_split.md)                                           | 5       |         | VIEW       |
| [next.commission_tier](next.commission_tier.md)                                             | 8       |         | BASE TABLE |
| [next.critical_date](next.critical_date.md)                                                 | 21      |         | BASE TABLE |
| [next.current_lease](next.current_lease.md)                                                 | 23      |         | VIEW       |
| [next.deal](next.deal.md)                                                                   | 19      |         | BASE TABLE |
| [next.deal_attention_alert](next.deal_attention_alert.md)                                   | 4       |         | BASE TABLE |
| [next.deal_client_website](next.deal_client_website.md)                                     | 10      |         | BASE TABLE |
| [next.deal_client_website_attempt](next.deal_client_website_attempt.md)                     | 3       |         | BASE TABLE |
| [next.deal_client_website_grant](next.deal_client_website_grant.md)                         | 4       |         | BASE TABLE |
| [next.deal_imported_history](next.deal_imported_history.md)                                 | 2       |         | VIEW       |
| [next.deal_invoiced](next.deal_invoiced.md)                                                 | 2       |         | VIEW       |
| [next.deal_kind](next.deal_kind.md)                                                         | 6       |         | BASE TABLE |
| [next.deal_next_date](next.deal_next_date.md)                                               | 2       |         | VIEW       |
| [next.deal_open_name](next.deal_open_name.md)                                               | 2       |         | BASE TABLE |
| [next.deal_party](next.deal_party.md)                                                       | 9       |         | BASE TABLE |
| [next.deal_phase_change](next.deal_phase_change.md)                                         | 11      |         | BASE TABLE |
| [next.deal_plan_date](next.deal_plan_date.md)                                               | 7       |         | BASE TABLE |
| [next.deal_property](next.deal_property.md)                                                 | 7       |         | BASE TABLE |
| [next.deal_reason](next.deal_reason.md)                                                     | 6       |         | BASE TABLE |
| [next.design_template](next.design_template.md)                                             | 7       |         | BASE TABLE |
| [next.do_not_contact](next.do_not_contact.md)                                               | 8       |         | BASE TABLE |
| [next.doc_conversation](next.doc_conversation.md)                                           | 4       |         | BASE TABLE |
| [next.doc_judgment_destination](next.doc_judgment_destination.md)                           | 6       |         | BASE TABLE |
| [next.doc_judgment_job](next.doc_judgment_job.md)                                           | 13      |         | BASE TABLE |
| [next.doc_link](next.doc_link.md)                                                           | 7       |         | BASE TABLE |
| [next.doc_turn](next.doc_turn.md)                                                           | 17      |         | BASE TABLE |
| [next.document](next.document.md)                                                           | 18      |         | BASE TABLE |
| [next.document_extraction](next.document_extraction.md)                                     | 16      |         | BASE TABLE |
| [next.document_kind](next.document_kind.md)                                                 | 6       |         | BASE TABLE |
| [next.email](next.email.md)                                                                 | 15      |         | BASE TABLE |
| [next.email_current_summary](next.email_current_summary.md)                                 | 7       |         | VIEW       |
| [next.email_document](next.email_document.md)                                               | 7       |         | BASE TABLE |
| [next.email_mailbox](next.email_mailbox.md)                                                 | 6       |         | BASE TABLE |
| [next.email_recipient](next.email_recipient.md)                                             | 8       |         | BASE TABLE |
| [next.email_summary](next.email_summary.md)                                                 | 8       |         | BASE TABLE |
| [next.home_mark](next.home_mark.md)                                                         | 18      |         | BASE TABLE |
| [next.home_next_step](next.home_next_step.md)                                               | 24      |         | VIEW       |
| [next.home_update](next.home_update.md)                                                     | 15      |         | BASE TABLE |
| [next.how_found](next.how_found.md)                                                         | 6       |         | BASE TABLE |
| [next.idea](next.idea.md)                                                                   | 9       |         | BASE TABLE |
| [next.imported_automatic_phase_move](next.imported_automatic_phase_move.md)                 | 5       |         | BASE TABLE |
| [next.imported_change](next.imported_change.md)                                             | 12      |         | BASE TABLE |
| [next.imported_deal_board](next.imported_deal_board.md)                                     | 11      |         | BASE TABLE |
| [next.imported_deal_history](next.imported_deal_history.md)                                 | 26      |         | BASE TABLE |
| [next.imported_deal_invoiced](next.imported_deal_invoiced.md)                               | 6       |         | BASE TABLE |
| [next.imported_deal_owner](next.imported_deal_owner.md)                                     | 9       |         | BASE TABLE |
| [next.imported_deal_party](next.imported_deal_party.md)                                     | 10      |         | BASE TABLE |
| [next.introduction](next.introduction.md)                                                   | 18      |         | BASE TABLE |
| [next.invoice_email](next.invoice_email.md)                                                 | 22      |         | BASE TABLE |
| [next.invoice_mailbox](next.invoice_mailbox.md)                                             | 5       |         | BASE TABLE |
| [next.job](next.job.md)                                                                     | 2       |         | BASE TABLE |
| [next.lead_contact_draft](next.lead_contact_draft.md)                                       | 17      |         | BASE TABLE |
| [next.lead_email_attention](next.lead_email_attention.md)                                   | 6       |         | BASE TABLE |
| [next.lead_email_evidence](next.lead_email_evidence.md)                                     | 5       |         | BASE TABLE |
| [next.lead_email_source](next.lead_email_source.md)                                         | 6       |         | BASE TABLE |
| [next.lead_lane](next.lead_lane.md)                                                         | 6       |         | BASE TABLE |
| [next.lead_source_sender](next.lead_source_sender.md)                                       | 6       |         | BASE TABLE |
| [next.lead_stage_move](next.lead_stage_move.md)                                             | 13      |         | BASE TABLE |
| [next.lease](next.lease.md)                                                                 | 10      |         | BASE TABLE |
| [next.lease_ending](next.lease_ending.md)                                                   | 23      |         | VIEW       |
| [next.lease_option](next.lease_option.md)                                                   | 10      |         | BASE TABLE |
| [next.lease_suite](next.lease_suite.md)                                                     | 9       |         | BASE TABLE |
| [next.lease_version](next.lease_version.md)                                                 | 24      |         | BASE TABLE |
| [next.market](next.market.md)                                                               | 7       |         | BASE TABLE |
| [next.market_city](next.market_city.md)                                                     | 7       |         | BASE TABLE |
| [next.market_county](next.market_county.md)                                                 | 7       |         | BASE TABLE |
| [next.measurement](next.measurement.md)                                                     | 11      |         | BASE TABLE |
| [next.merged_party](next.merged_party.md)                                                   | 7       |         | BASE TABLE |
| [next.national_account](next.national_account.md)                                           | 8       |         | BASE TABLE |
| [next.national_account_owner](next.national_account_owner.md)                               | 11      |         | BASE TABLE |
| [next.next_step](next.next_step.md)                                                         | 28      |         | BASE TABLE |
| [next.offer](next.offer.md)                                                                 | 27      |         | BASE TABLE |
| [next.offer_claim](next.offer_claim.md)                                                     | 10      |         | BASE TABLE |
| [next.offer_document](next.offer_document.md)                                               | 7       |         | BASE TABLE |
| [next.outside_id](next.outside_id.md)                                                       | 9       |         | BASE TABLE |
| [next.party](next.party.md)                                                                 | 12      |         | BASE TABLE |
| [next.party_company](next.party_company.md)                                                 | 13      |         | BASE TABLE |
| [next.party_document](next.party_document.md)                                               | 7       |         | BASE TABLE |
| [next.party_email](next.party_email.md)                                                     | 10      |         | BASE TABLE |
| [next.party_link](next.party_link.md)                                                       | 12      |         | BASE TABLE |
| [next.party_phone](next.party_phone.md)                                                     | 11      |         | BASE TABLE |
| [next.party_role](next.party_role.md)                                                       | 25      |         | BASE TABLE |
| [next.party_specialty](next.party_specialty.md)                                             | 8       |         | BASE TABLE |
| [next.party_territory](next.party_territory.md)                                             | 10      |         | BASE TABLE |
| [next.party_territory_review](next.party_territory_review.md)                               | 13      |         | BASE TABLE |
| [next.phase](next.phase.md)                                                                 | 6       |         | BASE TABLE |
| [next.platform_format](next.platform_format.md)                                             | 2       |         | BASE TABLE |
| [next.platform_metric](next.platform_metric.md)                                             | 3       |         | BASE TABLE |
| [next.post](next.post.md)                                                                   | 15      |         | BASE TABLE |
| [next.post_media](next.post_media.md)                                                       | 10      |         | BASE TABLE |
| [next.post_review](next.post_review.md)                                                     | 7       |         | BASE TABLE |
| [next.post_text](next.post_text.md)                                                         | 8       |         | BASE TABLE |
| [next.property](next.property.md)                                                           | 15      |         | BASE TABLE |
| [next.property_territory](next.property_territory.md)                                       | 2       |         | VIEW       |
| [next.proposal](next.proposal.md)                                                           | 44      |         | BASE TABLE |
| [next.relationship_level](next.relationship_level.md)                                       | 3       |         | BASE TABLE |
| [next.reply_draft](next.reply_draft.md)                                                     | 22      |         | BASE TABLE |
| [next.reply_draft_document](next.reply_draft_document.md)                                   | 7       |         | BASE TABLE |
| [next.role](next.role.md)                                                                   | 7       |         | BASE TABLE |
| [next.save_receipt](next.save_receipt.md)                                                   | 5       |         | BASE TABLE |
| [next.social_account](next.social_account.md)                                               | 11      |         | BASE TABLE |
| [next.social_sign_in](next.social_sign_in.md)                                               | 6       |         | BASE TABLE |
| [next.space_need](next.space_need.md)                                                       | 19      |         | BASE TABLE |
| [next.specialty](next.specialty.md)                                                         | 6       |         | BASE TABLE |
| [next.stage](next.stage.md)                                                                 | 7       |         | BASE TABLE |
| [next.suite](next.suite.md)                                                                 | 12      |         | BASE TABLE |
| [next.territory](next.territory.md)                                                         | 7       |         | BASE TABLE |
| [next.territory_piece](next.territory_piece.md)                                             | 12      |         | BASE TABLE |
| [next.tour_plan](next.tour_plan.md)                                                         | 13      |         | BASE TABLE |
| [next.tour_stop](next.tour_stop.md)                                                         | 8       |         | BASE TABLE |
| [next.typical_length](next.typical_length.md)                                               | 7       |         | BASE TABLE |
| [next.user_preference](next.user_preference.md)                                             | 10      |         | BASE TABLE |
| [next.vendor_loan_program](next.vendor_loan_program.md)                                     | 8       |         | BASE TABLE |
| [next.vendor_track_record](next.vendor_track_record.md)                                     | 6       |         | VIEW       |
| [next.vendor_vertical](next.vendor_vertical.md)                                             | 8       |         | BASE TABLE |
| [next.weekly_review](next.weekly_review.md)                                                 | 10      |         | BASE TABLE |
| [next_partner.activity](next_partner.activity.md)                                           | 13      |         | VIEW       |
| [next_partner.change](next_partner.change.md)                                               | 11      |         | VIEW       |
| [next_partner.deal_imported_history](next_partner.deal_imported_history.md)                 | 2       |         | VIEW       |
| [next_partner.deal_next_date](next_partner.deal_next_date.md)                               | 2       |         | VIEW       |
| [next_partner.deal_phase_change](next_partner.deal_phase_change.md)                         | 11      |         | VIEW       |
| [next_partner.home_update](next_partner.home_update.md)                                     | 15      |         | VIEW       |
| [next_partner.imported_automatic_phase_move](next_partner.imported_automatic_phase_move.md) | 5       |         | VIEW       |
| [next_partner.imported_change](next_partner.imported_change.md)                             | 12      |         | VIEW       |
| [next_partner.lead_stage_move](next_partner.lead_stage_move.md)                             | 13      |         | VIEW       |
| [next_partner.next_step](next_partner.next_step.md)                                         | 28      |         | VIEW       |
| [next_partner.proposal](next_partner.proposal.md)                                           | 44      |         | VIEW       |

## Stored procedures and functions

| Name                                          | ReturnType    | Arguments                                                                                                                                                    | Type     |
| --------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| next.activity_entry                           | jsonb         | a activity                                                                                                                                                   | FUNCTION |
| next.apply_lead_stage_move                    | trigger       |                                                                                                                                                              | FUNCTION |
| next.calendar_agenda_monotonic                | trigger       |                                                                                                                                                              | FUNCTION |
| next.candidate_review                         | trigger       |                                                                                                                                                              | FUNCTION |
| next.carry_weekly_review                      | void          | prospect_id uuid, new_deal_id uuid                                                                                                                           | FUNCTION |
| next.cash_dist                                | money         | money, money                                                                                                                                                 | FUNCTION |
| next.check_deal_plan_todo                     | trigger       |                                                                                                                                                              | FUNCTION |
| next.commission_adds_up                       | trigger       |                                                                                                                                                              | FUNCTION |
| next.commission_ladder_holds                  | trigger       |                                                                                                                                                              | FUNCTION |
| next.confirm_lead_client_link                 | trigger       |                                                                                                                                                              | FUNCTION |
| next.critical_date_transition                 | trigger       |                                                                                                                                                              | FUNCTION |
| next.date_dist                                | int4          | date, date                                                                                                                                                   | FUNCTION |
| next.deal_filing_reason                       | text          | email_id uuid, selected_deal_id uuid                                                                                                                         | FUNCTION |
| next.deal_parked_or_flagged_by_a_user         | trigger       |                                                                                                                                                              | FUNCTION |
| next.deal_party_rejoins_after_leaving         | trigger       |                                                                                                                                                              | FUNCTION |
| next.deal_renews_another_lease                | trigger       |                                                                                                                                                              | FUNCTION |
| next.decide_proposal                          | trigger       |                                                                                                                                                              | FUNCTION |
| next.decide_vendor_filing                     | trigger       |                                                                                                                                                              | FUNCTION |
| next.document_filed_once                      | trigger       |                                                                                                                                                              | FUNCTION |
| next.email_about_a_record                     | trigger       |                                                                                                                                                              | FUNCTION |
| next.email_without_message_id_once            | trigger       |                                                                                                                                                              | FUNCTION |
| next.erase_change                             | void          | removed_change_id bigint, fields text[]                                                                                                                      | FUNCTION |
| next.everything_about_deal                    | jsonb         | wanted uuid                                                                                                                                                  | FUNCTION |
| next.everything_about_party                   | jsonb         | wanted uuid                                                                                                                                                  | FUNCTION |
| next.float4_dist                              | float4        | real, real                                                                                                                                                   | FUNCTION |
| next.float8_dist                              | float8        | double precision, double precision                                                                                                                           | FUNCTION |
| next.gbt_bit_compress                         | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_bit_consistent                       | bool          | internal, bit, smallint, oid, internal                                                                                                                       | FUNCTION |
| next.gbt_bit_penalty                          | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_bit_picksplit                        | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_bit_same                             | internal      | gbtreekey_var, gbtreekey_var, internal                                                                                                                       | FUNCTION |
| next.gbt_bit_sortsupport                      | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_bit_union                            | gbtreekey_var | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_bool_compress                        | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_bool_consistent                      | bool          | internal, boolean, smallint, oid, internal                                                                                                                   | FUNCTION |
| next.gbt_bool_fetch                           | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_bool_penalty                         | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_bool_picksplit                       | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_bool_same                            | internal      | gbtreekey2, gbtreekey2, internal                                                                                                                             | FUNCTION |
| next.gbt_bool_sortsupport                     | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_bool_union                           | gbtreekey2    | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_bpchar_compress                      | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_bpchar_consistent                    | bool          | internal, character, smallint, oid, internal                                                                                                                 | FUNCTION |
| next.gbt_bpchar_sortsupport                   | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_bytea_compress                       | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_bytea_consistent                     | bool          | internal, bytea, smallint, oid, internal                                                                                                                     | FUNCTION |
| next.gbt_bytea_penalty                        | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_bytea_picksplit                      | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_bytea_same                           | internal      | gbtreekey_var, gbtreekey_var, internal                                                                                                                       | FUNCTION |
| next.gbt_bytea_sortsupport                    | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_bytea_union                          | gbtreekey_var | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_cash_compress                        | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_cash_consistent                      | bool          | internal, money, smallint, oid, internal                                                                                                                     | FUNCTION |
| next.gbt_cash_distance                        | float8        | internal, money, smallint, oid, internal                                                                                                                     | FUNCTION |
| next.gbt_cash_fetch                           | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_cash_penalty                         | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_cash_picksplit                       | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_cash_same                            | internal      | gbtreekey16, gbtreekey16, internal                                                                                                                           | FUNCTION |
| next.gbt_cash_sortsupport                     | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_cash_union                           | gbtreekey16   | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_date_compress                        | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_date_consistent                      | bool          | internal, date, smallint, oid, internal                                                                                                                      | FUNCTION |
| next.gbt_date_distance                        | float8        | internal, date, smallint, oid, internal                                                                                                                      | FUNCTION |
| next.gbt_date_fetch                           | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_date_penalty                         | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_date_picksplit                       | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_date_same                            | internal      | gbtreekey8, gbtreekey8, internal                                                                                                                             | FUNCTION |
| next.gbt_date_sortsupport                     | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_date_union                           | gbtreekey8    | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_decompress                           | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_enum_compress                        | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_enum_consistent                      | bool          | internal, anyenum, smallint, oid, internal                                                                                                                   | FUNCTION |
| next.gbt_enum_fetch                           | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_enum_penalty                         | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_enum_picksplit                       | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_enum_same                            | internal      | gbtreekey8, gbtreekey8, internal                                                                                                                             | FUNCTION |
| next.gbt_enum_sortsupport                     | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_enum_union                           | gbtreekey8    | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_float4_compress                      | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_float4_consistent                    | bool          | internal, real, smallint, oid, internal                                                                                                                      | FUNCTION |
| next.gbt_float4_distance                      | float8        | internal, real, smallint, oid, internal                                                                                                                      | FUNCTION |
| next.gbt_float4_fetch                         | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_float4_penalty                       | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_float4_picksplit                     | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_float4_same                          | internal      | gbtreekey8, gbtreekey8, internal                                                                                                                             | FUNCTION |
| next.gbt_float4_sortsupport                   | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_float4_union                         | gbtreekey8    | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_float8_compress                      | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_float8_consistent                    | bool          | internal, double precision, smallint, oid, internal                                                                                                          | FUNCTION |
| next.gbt_float8_distance                      | float8        | internal, double precision, smallint, oid, internal                                                                                                          | FUNCTION |
| next.gbt_float8_fetch                         | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_float8_penalty                       | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_float8_picksplit                     | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_float8_same                          | internal      | gbtreekey16, gbtreekey16, internal                                                                                                                           | FUNCTION |
| next.gbt_float8_sortsupport                   | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_float8_union                         | gbtreekey16   | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_inet_compress                        | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_inet_consistent                      | bool          | internal, inet, smallint, oid, internal                                                                                                                      | FUNCTION |
| next.gbt_inet_penalty                         | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_inet_picksplit                       | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_inet_same                            | internal      | gbtreekey16, gbtreekey16, internal                                                                                                                           | FUNCTION |
| next.gbt_inet_sortsupport                     | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_inet_union                           | gbtreekey16   | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_int2_compress                        | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_int2_consistent                      | bool          | internal, smallint, smallint, oid, internal                                                                                                                  | FUNCTION |
| next.gbt_int2_distance                        | float8        | internal, smallint, smallint, oid, internal                                                                                                                  | FUNCTION |
| next.gbt_int2_fetch                           | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_int2_penalty                         | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_int2_picksplit                       | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_int2_same                            | internal      | gbtreekey4, gbtreekey4, internal                                                                                                                             | FUNCTION |
| next.gbt_int2_sortsupport                     | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_int2_union                           | gbtreekey4    | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_int4_compress                        | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_int4_consistent                      | bool          | internal, integer, smallint, oid, internal                                                                                                                   | FUNCTION |
| next.gbt_int4_distance                        | float8        | internal, integer, smallint, oid, internal                                                                                                                   | FUNCTION |
| next.gbt_int4_fetch                           | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_int4_penalty                         | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_int4_picksplit                       | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_int4_same                            | internal      | gbtreekey8, gbtreekey8, internal                                                                                                                             | FUNCTION |
| next.gbt_int4_sortsupport                     | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_int4_union                           | gbtreekey8    | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_int8_compress                        | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_int8_consistent                      | bool          | internal, bigint, smallint, oid, internal                                                                                                                    | FUNCTION |
| next.gbt_int8_distance                        | float8        | internal, bigint, smallint, oid, internal                                                                                                                    | FUNCTION |
| next.gbt_int8_fetch                           | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_int8_penalty                         | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_int8_picksplit                       | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_int8_same                            | internal      | gbtreekey16, gbtreekey16, internal                                                                                                                           | FUNCTION |
| next.gbt_int8_sortsupport                     | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_int8_union                           | gbtreekey16   | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_intv_compress                        | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_intv_consistent                      | bool          | internal, interval, smallint, oid, internal                                                                                                                  | FUNCTION |
| next.gbt_intv_decompress                      | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_intv_distance                        | float8        | internal, interval, smallint, oid, internal                                                                                                                  | FUNCTION |
| next.gbt_intv_fetch                           | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_intv_penalty                         | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_intv_picksplit                       | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_intv_same                            | internal      | gbtreekey32, gbtreekey32, internal                                                                                                                           | FUNCTION |
| next.gbt_intv_sortsupport                     | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_intv_union                           | gbtreekey32   | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_macad8_compress                      | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_macad8_consistent                    | bool          | internal, macaddr8, smallint, oid, internal                                                                                                                  | FUNCTION |
| next.gbt_macad8_fetch                         | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_macad8_penalty                       | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_macad8_picksplit                     | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_macad8_same                          | internal      | gbtreekey16, gbtreekey16, internal                                                                                                                           | FUNCTION |
| next.gbt_macad8_sortsupport                   | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_macad8_union                         | gbtreekey16   | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_macad_compress                       | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_macad_consistent                     | bool          | internal, macaddr, smallint, oid, internal                                                                                                                   | FUNCTION |
| next.gbt_macad_fetch                          | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_macad_penalty                        | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_macad_picksplit                      | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_macad_same                           | internal      | gbtreekey16, gbtreekey16, internal                                                                                                                           | FUNCTION |
| next.gbt_macad_union                          | gbtreekey16   | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_macaddr_sortsupport                  | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_numeric_compress                     | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_numeric_consistent                   | bool          | internal, numeric, smallint, oid, internal                                                                                                                   | FUNCTION |
| next.gbt_numeric_penalty                      | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_numeric_picksplit                    | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_numeric_same                         | internal      | gbtreekey_var, gbtreekey_var, internal                                                                                                                       | FUNCTION |
| next.gbt_numeric_sortsupport                  | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_numeric_union                        | gbtreekey_var | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_oid_compress                         | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_oid_consistent                       | bool          | internal, oid, smallint, oid, internal                                                                                                                       | FUNCTION |
| next.gbt_oid_distance                         | float8        | internal, oid, smallint, oid, internal                                                                                                                       | FUNCTION |
| next.gbt_oid_fetch                            | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_oid_penalty                          | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_oid_picksplit                        | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_oid_same                             | internal      | gbtreekey8, gbtreekey8, internal                                                                                                                             | FUNCTION |
| next.gbt_oid_sortsupport                      | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_oid_union                            | gbtreekey8    | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_text_compress                        | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_text_consistent                      | bool          | internal, text, smallint, oid, internal                                                                                                                      | FUNCTION |
| next.gbt_text_penalty                         | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_text_picksplit                       | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_text_same                            | internal      | gbtreekey_var, gbtreekey_var, internal                                                                                                                       | FUNCTION |
| next.gbt_text_sortsupport                     | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_text_union                           | gbtreekey_var | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_time_compress                        | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_time_consistent                      | bool          | internal, time without time zone, smallint, oid, internal                                                                                                    | FUNCTION |
| next.gbt_time_distance                        | float8        | internal, time without time zone, smallint, oid, internal                                                                                                    | FUNCTION |
| next.gbt_time_fetch                           | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_time_penalty                         | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_time_picksplit                       | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_time_same                            | internal      | gbtreekey16, gbtreekey16, internal                                                                                                                           | FUNCTION |
| next.gbt_time_sortsupport                     | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_time_union                           | gbtreekey16   | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_timetz_compress                      | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_timetz_consistent                    | bool          | internal, time with time zone, smallint, oid, internal                                                                                                       | FUNCTION |
| next.gbt_ts_compress                          | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_ts_consistent                        | bool          | internal, timestamp without time zone, smallint, oid, internal                                                                                               | FUNCTION |
| next.gbt_ts_distance                          | float8        | internal, timestamp without time zone, smallint, oid, internal                                                                                               | FUNCTION |
| next.gbt_ts_fetch                             | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_ts_penalty                           | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_ts_picksplit                         | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_ts_same                              | internal      | gbtreekey16, gbtreekey16, internal                                                                                                                           | FUNCTION |
| next.gbt_ts_sortsupport                       | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_ts_union                             | gbtreekey16   | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_tstz_compress                        | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_tstz_consistent                      | bool          | internal, timestamp with time zone, smallint, oid, internal                                                                                                  | FUNCTION |
| next.gbt_tstz_distance                        | float8        | internal, timestamp with time zone, smallint, oid, internal                                                                                                  | FUNCTION |
| next.gbt_uuid_compress                        | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_uuid_consistent                      | bool          | internal, uuid, smallint, oid, internal                                                                                                                      | FUNCTION |
| next.gbt_uuid_fetch                           | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_uuid_penalty                         | internal      | internal, internal, internal                                                                                                                                 | FUNCTION |
| next.gbt_uuid_picksplit                       | internal      | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_uuid_same                            | internal      | gbtreekey32, gbtreekey32, internal                                                                                                                           | FUNCTION |
| next.gbt_uuid_sortsupport                     | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbt_uuid_union                           | gbtreekey32   | internal, internal                                                                                                                                           | FUNCTION |
| next.gbt_var_decompress                       | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_var_fetch                            | internal      | internal                                                                                                                                                     | FUNCTION |
| next.gbt_varbit_sortsupport                   | void          | internal                                                                                                                                                     | FUNCTION |
| next.gbtreekey16_in                           | gbtreekey16   | cstring                                                                                                                                                      | FUNCTION |
| next.gbtreekey16_out                          | cstring       | gbtreekey16                                                                                                                                                  | FUNCTION |
| next.gbtreekey2_in                            | gbtreekey2    | cstring                                                                                                                                                      | FUNCTION |
| next.gbtreekey2_out                           | cstring       | gbtreekey2                                                                                                                                                   | FUNCTION |
| next.gbtreekey32_in                           | gbtreekey32   | cstring                                                                                                                                                      | FUNCTION |
| next.gbtreekey32_out                          | cstring       | gbtreekey32                                                                                                                                                  | FUNCTION |
| next.gbtreekey4_in                            | gbtreekey4    | cstring                                                                                                                                                      | FUNCTION |
| next.gbtreekey4_out                           | cstring       | gbtreekey4                                                                                                                                                   | FUNCTION |
| next.gbtreekey8_in                            | gbtreekey8    | cstring                                                                                                                                                      | FUNCTION |
| next.gbtreekey8_out                           | cstring       | gbtreekey8                                                                                                                                                   | FUNCTION |
| next.gbtreekey_var_in                         | gbtreekey_var | cstring                                                                                                                                                      | FUNCTION |
| next.gbtreekey_var_out                        | cstring       | gbtreekey_var                                                                                                                                                | FUNCTION |
| next.gist_translate_cmptype_btree             | int2          | integer                                                                                                                                                      | FUNCTION |
| next.home_mark_dropped_final                  | trigger       |                                                                                                                                                              | FUNCTION |
| next.home_mark_drops_failed_reply             | trigger       |                                                                                                                                                              | FUNCTION |
| next.how_found_not_recorded_only_imported     | trigger       |                                                                                                                                                              | FUNCTION |
| next.int2_dist                                | int2          | smallint, smallint                                                                                                                                           | FUNCTION |
| next.int4_dist                                | int4          | integer, integer                                                                                                                                             | FUNCTION |
| next.int8_dist                                | int8          | bigint, bigint                                                                                                                                               | FUNCTION |
| next.interval_dist                            | interval      | interval, interval                                                                                                                                           | FUNCTION |
| next.invoice_email_target                     | record        | evidence invoice_email                                                                                                                                       | FUNCTION |
| next.invoice_email_transition                 | trigger       |                                                                                                                                                              | FUNCTION |
| next.invoice_name                             | text          | value text                                                                                                                                                   | FUNCTION |
| next.is_time_zone                             | bool          | zone text                                                                                                                                                    | FUNCTION |
| next.keep_call_recorder                       | trigger       |                                                                                                                                                              | FUNCTION |
| next.keep_recorded_introduction               | trigger       |                                                                                                                                                              | FUNCTION |
| next.lead_contact_draft_review                | trigger       |                                                                                                                                                              | FUNCTION |
| next.lead_email_attention_change              | trigger       |                                                                                                                                                              | FUNCTION |
| next.lead_flagged_by_a_user                   | trigger       |                                                                                                                                                              | FUNCTION |
| next.lead_or_client_how_found                 | trigger       |                                                                                                                                                              | FUNCTION |
| next.lead_stage_needs_evidence                | trigger       |                                                                                                                                                              | FUNCTION |
| next.lease_from_accepted_offer                | trigger       |                                                                                                                                                              | FUNCTION |
| next.lease_option_before_expiration           | trigger       |                                                                                                                                                              | FUNCTION |
| next.lock_weekly_review                       | void          | week_of date, deal_id uuid, party_id uuid                                                                                                                    | FUNCTION |
| next.mail_sender_vendors                      | uuid          | email_id uuid                                                                                                                                                | FUNCTION |
| next.measurement_after_publishing             | trigger       |                                                                                                                                                              | FUNCTION |
| next.merge_party                              | void          | duplicate uuid, survivor uuid                                                                                                                                | FUNCTION |
| next.miles_between                            | float8        | lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision                                                                   | FUNCTION |
| next.next_step_default_owner                  | trigger       |                                                                                                                                                              | FUNCTION |
| next.next_step_reopened                       | trigger       |                                                                                                                                                              | FUNCTION |
| next.npi_check_digit_holds                    | bool          | npi text                                                                                                                                                     | FUNCTION |
| next.offer_status_moves                       | trigger       |                                                                                                                                                              | FUNCTION |
| next.offer_superseded_by_later_acceptance     | trigger       |                                                                                                                                                              | FUNCTION |
| next.oid_dist                                 | oid           | oid, oid                                                                                                                                                     | FUNCTION |
| next.party_document_stored                    | trigger       |                                                                                                                                                              | FUNCTION |
| next.party_name_saved_nonblank                | trigger       |                                                                                                                                                              | FUNCTION |
| next.party_never_merged                       | trigger       |                                                                                                                                                              | FUNCTION |
| next.party_role_category_of_a_vendor          | trigger       |                                                                                                                                                              | FUNCTION |
| next.post_engine_publishes_from               | trigger       |                                                                                                                                                              | FUNCTION |
| next.post_final                               | trigger       |                                                                                                                                                              | FUNCTION |
| next.post_review_in_window                    | trigger       |                                                                                                                                                              | FUNCTION |
| next.post_status_moves                        | trigger       |                                                                                                                                                              | FUNCTION |
| next.post_text_before_review_closes           | trigger       |                                                                                                                                                              | FUNCTION |
| next.posts_at_day_7                           | jsonb         | as_of timestamp with time zone                                                                                                                               | FUNCTION |
| next.propose_critical_dates                   | void          | wanted uuid                                                                                                                                                  | FUNCTION |
| next.queue_email_filing                       | void          | email_id uuid                                                                                                                                                | FUNCTION |
| next.queue_email_split                        | void          | email_id uuid                                                                                                                                                | FUNCTION |
| next.queue_email_summary                      | void          | email_id uuid                                                                                                                                                | FUNCTION |
| next.queue_introduction                       | void          | email_id uuid                                                                                                                                                | FUNCTION |
| next.record_change                            | trigger       |                                                                                                                                                              | FUNCTION |
| next.record_email_summary                     | email_summary | email_id uuid, captured_hash text, writer_version text, result_status text, summary_text text, result_provenance jsonb, result_time timestamp with time zone | FUNCTION |
| next.reply_draft_delivery                     | trigger       |                                                                                                                                                              | FUNCTION |
| next.reply_draft_doc_origin                   | trigger       |                                                                                                                                                              | FUNCTION |
| next.reply_draft_document_owner_edits         | trigger       |                                                                                                                                                              | FUNCTION |
| next.revise_tour_plan                         | trigger       |                                                                                                                                                              | FUNCTION |
| next.settle_filing_proposals                  | trigger       |                                                                                                                                                              | FUNCTION |
| next.stamp_change                             | trigger       |                                                                                                                                                              | FUNCTION |
| next.stamp_doc_turn_requeue                   | trigger       |                                                                                                                                                              | FUNCTION |
| next.stamp_review                             | trigger       |                                                                                                                                                              | FUNCTION |
| next.supersede_filing                         | trigger       |                                                                                                                                                              | FUNCTION |
| next.sync_deal_open_name                      | trigger       |                                                                                                                                                              | FUNCTION |
| next.time_dist                                | interval      | time without time zone, time without time zone                                                                                                               | FUNCTION |
| next.tour_plan_requires_stop                  | trigger       |                                                                                                                                                              | FUNCTION |
| next.tour_stop_on_open_plan                   | trigger       |                                                                                                                                                              | FUNCTION |
| next.ts_dist                                  | interval      | timestamp without time zone, timestamp without time zone                                                                                                     | FUNCTION |
| next.tstz_dist                                | interval      | timestamp with time zone, timestamp with time zone                                                                                                           | FUNCTION |
| next.vendor_reason_not_recorded_only_imported | trigger       |                                                                                                                                                              | FUNCTION |
| next.weekly_review_undo_by_partner            | trigger       |                                                                                                                                                              | FUNCTION |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
