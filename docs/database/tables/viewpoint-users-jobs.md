# Users and jobs

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "App user"
  "Job"
  "Activity (area)" {
    string activity
    string activity_about
    string deal_attention_alert
    string next_step
  }
  "Changes and preferences (area)" {
    string change
    string imported_change
    string user_preference
  }
  "Client websites (area)" {
    string deal_client_website
    string deal_client_website_grant
  }
  "Clients (area)" {
    string client
    string client_brand
    string client_research
    string client_research_fact
    string client_type
    string client_vertical
    string national_account
    string national_account_owner
  }
  "Commissions (area)" {
    string commission
    string commission_payment
    string commission_share
    string commission_tier
  }
  "Deals (area)" {
    string deal
    string deal_kind
    string deal_party
    string deal_phase_change
    string deal_reason
    string phase
    string stage
    string typical_length
  }
  "Doc (area)" {
    string doc_conversation
    string doc_judgment_job
    string doc_link
  }
  "Documents (area)" {
    string document
    string document_extraction
    string document_kind
    string party_document
  }
  "Email (area)" {
    string email
    string email_document
    string email_mailbox
    string email_recipient
    string reply_draft
    string reply_draft_document
  }
  "Home and calendar (area)" {
    string calendar_agenda
    string calendar_review_dismissal
    string home_mark
    string home_update
    string weekly_review
  }
  "Imported deals (area)" {
    string imported_deal_board
    string imported_deal_history
    string imported_deal_invoiced
    string imported_deal_owner
    string imported_deal_party
  }
  "Invoices (area)" {
    string invoice_email
    string invoice_mailbox
  }
  "Leads (area)" {
    string candidate
    string lead_contact_draft
    string lead_email_attention
    string lead_email_evidence
    string lead_lane
    string lead_stage_move
  }
  "Leases (area)" {
    string critical_date
    string lease
    string lease_option
    string lease_suite
    string lease_version
  }
  "Marketing categories (area)" {
    string design_template
    string idea
  }
  "Marketing posts (area)" {
    string post
    string post_media
  }
  "Marketing review (area)" {
    string post_review
    string post_text
  }
  "Offers (area)" {
    string offer
    string offer_claim
    string offer_document
    string proposal
  }
  "People (area)" {
    string do_not_contact
    string merged_party
    string outside_id
    string party
    string party_company
    string party_email
    string party_phone
  }
  "Property (area)" {
    string building_ownership
    string deal_property
    string measurement
    string property
    string space_need
    string suite
  }
  "Relationships (area)" {
    string claim_type
    string how_found
    string introduction
    string party_link
    string party_role
    string party_specialty
    string role
    string specialty
  }
  "Social accounts (area)" {
    string social_account
    string social_sign_in
  }
  "Tours (area)" {
    string tour_plan
    string tour_stop
  }
  "Vendors and territories (area)" {
    string market
    string market_city
    string market_county
    string party_territory
    string party_territory_review
    string territory
    string territory_piece
    string vendor_loan_program
    string vendor_vertical
  }
  "Activity (area)" }o--o| "App user" : "Activity: calendar review user ID"
  "Activity (area)" }o--o| "App user" : "Activity: call owner user ID"
  "Activity (area)" }o--o| "App user" : "Activity: changed by user ID"
  "Activity (area)" }o--o| "App user" : "Activity: changed for user ID"
  "Activity (area)" }o--o| "Job" : "Activity: changed by job"
  "Activity (area)" }o--o| "App user" : "Activity about: changed by user ID"
  "Activity (area)" }o--o| "App user" : "Activity about: changed for user ID"
  "Activity (area)" }o--o| "Job" : "Activity about: changed by job"
  "App user" }o--|| "People (area)" : "ID, kind to Party"
  "Property (area)" }o--o| "App user" : "Building ownership: changed by user ID"
  "Property (area)" }o--o| "App user" : "Building ownership: changed for user ID"
  "Property (area)" }o--o| "Job" : "Building ownership: changed by job"
  "Home and calendar (area)" }o--o| "App user" : "Calendar agenda: changed by user ID"
  "Home and calendar (area)" }o--o| "App user" : "Calendar agenda: changed for user ID"
  "Home and calendar (area)" |o--|| "App user" : "Calendar agenda: user ID"
  "Home and calendar (area)" }o--o| "Job" : "Calendar agenda: changed by job"
  "Home and calendar (area)" }o--o| "App user" : "Calendar review dismissal: changed by user ID"
  "Home and calendar (area)" }o--o| "App user" : "Calendar review dismissal: changed for user ID"
  "Home and calendar (area)" }o--|| "App user" : "Calendar review dismissal: user ID"
  "Home and calendar (area)" }o--o| "Job" : "Calendar review dismissal: changed by job"
  "Leads (area)" }o--o| "App user" : "Candidate: changed by user ID"
  "Leads (area)" }o--o| "App user" : "Candidate: changed for user ID"
  "Leads (area)" }o--o| "Job" : "Candidate: changed by job"
  "Changes and preferences (area)" }o--o| "App user" : "Change: changed by user ID"
  "Changes and preferences (area)" }o--o| "App user" : "Change: changed for user ID"
  "Changes and preferences (area)" }o--o| "Job" : "Change: changed by job"
  "Relationships (area)" }o--o| "App user" : "Claim type: changed by user ID"
  "Relationships (area)" }o--o| "App user" : "Claim type: changed for user ID"
  "Relationships (area)" }o--o| "Job" : "Claim type: changed by job"
  "Clients (area)" }o--o| "App user" : "Client: changed by user ID"
  "Clients (area)" }o--o| "App user" : "Client: changed for user ID"
  "Clients (area)" }o--o| "App user" : "Client: owner user ID"
  "Clients (area)" }o--o| "Job" : "Client: changed by job"
  "Clients (area)" }o--o| "App user" : "Client brand: changed by user ID"
  "Clients (area)" }o--o| "App user" : "Client brand: changed for user ID"
  "Clients (area)" }o--o| "Job" : "Client brand: changed by job"
  "Clients (area)" }o--o| "App user" : "Client research: changed by user ID"
  "Clients (area)" }o--o| "App user" : "Client research: changed for user ID"
  "Clients (area)" }o--o| "Job" : "Client research: changed by job"
  "Clients (area)" }o--o| "App user" : "Client research fact: changed by user ID"
  "Clients (area)" }o--o| "App user" : "Client research fact: changed for user ID"
  "Clients (area)" }o--o| "Job" : "Client research fact: changed by job"
  "Clients (area)" }o--o| "App user" : "Client type: changed by user ID"
  "Clients (area)" }o--o| "App user" : "Client type: changed for user ID"
  "Clients (area)" }o--o| "Job" : "Client type: changed by job"
  "Clients (area)" }o--o| "App user" : "Client vertical: changed by user ID"
  "Clients (area)" }o--o| "App user" : "Client vertical: changed for user ID"
  "Clients (area)" }o--o| "Job" : "Client vertical: changed by job"
  "Commissions (area)" }o--o| "App user" : "Commission: changed by user ID"
  "Commissions (area)" }o--o| "App user" : "Commission: changed for user ID"
  "Commissions (area)" }o--o| "Job" : "Commission: changed by job"
  "Commissions (area)" }o--o| "App user" : "Commission payment: changed by user ID"
  "Commissions (area)" }o--o| "App user" : "Commission payment: changed for user ID"
  "Commissions (area)" }o--o| "Job" : "Commission payment: changed by job"
  "Commissions (area)" }o--o| "App user" : "Commission share: changed by user ID"
  "Commissions (area)" }o--o| "App user" : "Commission share: changed for user ID"
  "Commissions (area)" }o--o| "Job" : "Commission share: changed by job"
  "Commissions (area)" }o--o| "App user" : "Commission tier: changed by user ID"
  "Commissions (area)" }o--o| "App user" : "Commission tier: changed for user ID"
  "Commissions (area)" }o--|| "App user" : "Commission tier: partner user ID"
  "Commissions (area)" }o--|| "App user" : "Commission tier: user ID"
  "Commissions (area)" }o--o| "Job" : "Commission tier: changed by job"
  "Leases (area)" }o--o| "App user" : "Critical date: changed by user ID"
  "Leases (area)" }o--o| "App user" : "Critical date: changed for user ID"
  "Leases (area)" }o--o| "App user" : "Critical date: confirmed by user ID"
  "Leases (area)" }o--o| "App user" : "Critical date: resolved by user ID"
  "Leases (area)" }o--o| "Job" : "Critical date: changed by job"
  "Deals (area)" }o--o| "App user" : "Deal: changed by user ID"
  "Deals (area)" }o--o| "App user" : "Deal: changed for user ID"
  "Deals (area)" }o--|| "App user" : "Deal: owner user ID"
  "Deals (area)" }o--o| "App user" : "Deal: parked by user ID"
  "Deals (area)" }o--o| "Job" : "Deal: changed by job"
  "Activity (area)" }o--|| "App user" : "Deal attention alert: owner user ID"
  "Client websites (area)" }o--o| "App user" : "Deal client website: changed by user ID"
  "Client websites (area)" }o--o| "App user" : "Deal client website: changed for user ID"
  "Client websites (area)" }o--o| "Job" : "Deal client website: changed by job"
  "Client websites (area)" }o--|| "App user" : "Deal client website grant: user ID"
  "Deals (area)" }o--o| "App user" : "Deal kind: changed by user ID"
  "Deals (area)" }o--o| "App user" : "Deal kind: changed for user ID"
  "Deals (area)" }o--o| "Job" : "Deal kind: changed by job"
  "Deals (area)" }o--o| "App user" : "Deal party: changed by user ID"
  "Deals (area)" }o--o| "App user" : "Deal party: changed for user ID"
  "Deals (area)" }o--o| "Job" : "Deal party: changed by job"
  "Deals (area)" }o--o| "App user" : "Deal phase change: changed by user ID"
  "Deals (area)" }o--o| "App user" : "Deal phase change: changed for user ID"
  "Deals (area)" }o--o| "Job" : "Deal phase change: changed by job"
  "Property (area)" }o--o| "App user" : "Deal property: changed by user ID"
  "Property (area)" }o--o| "App user" : "Deal property: changed for user ID"
  "Property (area)" }o--o| "Job" : "Deal property: changed by job"
  "Deals (area)" }o--o| "App user" : "Deal reason: changed by user ID"
  "Deals (area)" }o--o| "App user" : "Deal reason: changed for user ID"
  "Deals (area)" }o--o| "Job" : "Deal reason: changed by job"
  "Marketing categories (area)" }o--o| "App user" : "Design template: changed by user ID"
  "Marketing categories (area)" }o--o| "App user" : "Design template: changed for user ID"
  "Marketing categories (area)" }o--o| "Job" : "Design template: changed by job"
  "People (area)" }o--o| "App user" : "Do not contact: changed by user ID"
  "People (area)" }o--o| "App user" : "Do not contact: changed for user ID"
  "People (area)" }o--o| "Job" : "Do not contact: changed by job"
  "Doc (area)" }o--|| "App user" : "Doc conversation: owner user ID, is account partner"
  "Doc (area)" }o--|| "App user" : "Doc judgment job: owner user ID, is account partner"
  "Doc (area)" }o--|| "App user" : "Doc link: owner user ID, is account partner"
  "Documents (area)" }o--o| "App user" : "Document: changed by user ID"
  "Documents (area)" }o--o| "App user" : "Document: changed for user ID"
  "Documents (area)" }o--o| "Job" : "Document: changed by job"
  "Documents (area)" }o--o| "App user" : "Document extraction: changed by user ID"
  "Documents (area)" }o--o| "App user" : "Document extraction: changed for user ID"
  "Documents (area)" }o--o| "Job" : "Document extraction: changed by job"
  "Documents (area)" }o--o| "App user" : "Document kind: changed by user ID"
  "Documents (area)" }o--o| "App user" : "Document kind: changed for user ID"
  "Documents (area)" }o--o| "Job" : "Document kind: changed by job"
  "Email (area)" }o--o| "App user" : "Email: changed by user ID"
  "Email (area)" }o--o| "App user" : "Email: changed for user ID"
  "Email (area)" }o--o| "Job" : "Email: changed by job"
  "Email (area)" }o--o| "App user" : "Email document: changed by user ID"
  "Email (area)" }o--o| "App user" : "Email document: changed for user ID"
  "Email (area)" }o--o| "Job" : "Email document: changed by job"
  "Email (area)" }o--o| "App user" : "Email mailbox: changed by user ID"
  "Email (area)" }o--o| "App user" : "Email mailbox: changed for user ID"
  "Email (area)" }o--|| "App user" : "Email mailbox: user ID"
  "Email (area)" }o--o| "Job" : "Email mailbox: changed by job"
  "Email (area)" }o--o| "App user" : "Email recipient: changed by user ID"
  "Email (area)" }o--o| "App user" : "Email recipient: changed for user ID"
  "Email (area)" }o--o| "Job" : "Email recipient: changed by job"
  "Home and calendar (area)" }o--o| "App user" : "Home mark: changed by user ID"
  "Home and calendar (area)" }o--o| "App user" : "Home mark: changed for user ID"
  "Home and calendar (area)" }o--|| "App user" : "Home mark: user ID"
  "Home and calendar (area)" }o--o| "Job" : "Home mark: changed by job"
  "Home and calendar (area)" }o--o| "App user" : "Home update: changed by user ID"
  "Home and calendar (area)" }o--o| "App user" : "Home update: changed for user ID"
  "Home and calendar (area)" }o--|| "App user" : "Home update: user ID"
  "Home and calendar (area)" }o--o| "Job" : "Home update: changed by job"
  "Relationships (area)" }o--o| "App user" : "How found: changed by user ID"
  "Relationships (area)" }o--o| "App user" : "How found: changed for user ID"
  "Relationships (area)" }o--o| "Job" : "How found: changed by job"
  "Marketing categories (area)" }o--o| "App user" : "Idea: changed by user ID"
  "Marketing categories (area)" }o--o| "App user" : "Idea: changed for user ID"
  "Marketing categories (area)" }o--o| "Job" : "Idea: changed by job"
  "Changes and preferences (area)" }o--o| "App user" : "Imported change: changed by user ID"
  "Changes and preferences (area)" }o--o| "App user" : "Imported change: changed for user ID"
  "Changes and preferences (area)" }o--o| "Job" : "Imported change: changed by job"
  "Imported deals (area)" }o--o| "App user" : "Imported deal board: changed by user ID"
  "Imported deals (area)" }o--o| "App user" : "Imported deal board: changed for user ID"
  "Imported deals (area)" }o--o| "Job" : "Imported deal board: changed by job"
  "Imported deals (area)" }o--o| "App user" : "Imported deal history: changed by user ID"
  "Imported deals (area)" }o--o| "Job" : "Imported deal history: changed by job"
  "Imported deals (area)" }o--o| "App user" : "Imported deal invoiced: changed by user ID"
  "Imported deals (area)" }o--o| "App user" : "Imported deal invoiced: changed for user ID"
  "Imported deals (area)" }o--o| "Job" : "Imported deal invoiced: changed by job"
  "Imported deals (area)" }o--o| "App user" : "Imported deal owner: changed by user ID"
  "Imported deals (area)" }o--o| "App user" : "Imported deal owner: changed for user ID"
  "Imported deals (area)" }o--|| "App user" : "Imported deal owner: user ID"
  "Imported deals (area)" }o--o| "Job" : "Imported deal owner: changed by job"
  "Imported deals (area)" }o--o| "App user" : "Imported deal party: changed by user ID"
  "Imported deals (area)" }o--o| "App user" : "Imported deal party: changed for user ID"
  "Imported deals (area)" }o--o| "Job" : "Imported deal party: changed by job"
  "Relationships (area)" }o--o| "App user" : "Introduction: changed by user ID"
  "Relationships (area)" }o--o| "App user" : "Introduction: changed for user ID"
  "Relationships (area)" }o--o| "App user" : "Introduction: introduced by user ID"
  "Relationships (area)" }o--o| "Job" : "Introduction: changed by job"
  "Invoices (area)" }o--o| "App user" : "Invoice email: changed by user ID"
  "Invoices (area)" }o--o| "App user" : "Invoice email: changed for user ID"
  "Invoices (area)" }o--o| "Job" : "Invoice email: changed by job"
  "Invoices (area)" }o--o| "App user" : "Invoice mailbox: changed by user ID"
  "Invoices (area)" }o--o| "App user" : "Invoice mailbox: changed for user ID"
  "Invoices (area)" }o--o| "Job" : "Invoice mailbox: changed by job"
  "Leads (area)" }o--o| "App user" : "Lead contact draft: changed by user ID"
  "Leads (area)" }o--o| "App user" : "Lead contact draft: changed for user ID"
  "Leads (area)" }o--o| "App user" : "Lead contact draft: owner user ID"
  "Leads (area)" }o--o| "Job" : "Lead contact draft: changed by job"
  "Leads (area)" }o--o| "App user" : "Lead email attention: acknowledged by user ID, acknowledger is partner"
  "Leads (area)" }o--|| "App user" : "Lead email evidence: mailbox user ID"
  "Leads (area)" }o--o| "App user" : "Lead lane: changed by user ID"
  "Leads (area)" }o--o| "App user" : "Lead lane: changed for user ID"
  "Leads (area)" }o--o| "Job" : "Lead lane: changed by job"
  "Leads (area)" }o--o| "App user" : "Lead stage move: changed by user ID"
  "Leads (area)" }o--o| "App user" : "Lead stage move: changed for user ID"
  "Leads (area)" }o--o| "Job" : "Lead stage move: changed by job"
  "Leases (area)" }o--o| "App user" : "Lease: changed by user ID"
  "Leases (area)" }o--o| "App user" : "Lease: changed for user ID"
  "Leases (area)" }o--o| "Job" : "Lease: changed by job"
  "Leases (area)" }o--o| "App user" : "Lease option: changed by user ID"
  "Leases (area)" }o--o| "App user" : "Lease option: changed for user ID"
  "Leases (area)" }o--o| "Job" : "Lease option: changed by job"
  "Leases (area)" }o--o| "App user" : "Lease suite: changed by user ID"
  "Leases (area)" }o--o| "App user" : "Lease suite: changed for user ID"
  "Leases (area)" }o--o| "Job" : "Lease suite: changed by job"
  "Leases (area)" }o--o| "App user" : "Lease version: changed by user ID"
  "Leases (area)" }o--o| "App user" : "Lease version: changed for user ID"
  "Leases (area)" }o--o| "Job" : "Lease version: changed by job"
  "Vendors and territories (area)" }o--o| "App user" : "Market: changed by user ID"
  "Vendors and territories (area)" }o--o| "App user" : "Market: changed for user ID"
  "Vendors and territories (area)" }o--o| "Job" : "Market: changed by job"
  "Vendors and territories (area)" }o--o| "App user" : "Market city: changed by user ID"
  "Vendors and territories (area)" }o--o| "App user" : "Market city: changed for user ID"
  "Vendors and territories (area)" }o--o| "Job" : "Market city: changed by job"
  "Vendors and territories (area)" }o--o| "App user" : "Market county: changed by user ID"
  "Vendors and territories (area)" }o--o| "App user" : "Market county: changed for user ID"
  "Vendors and territories (area)" }o--o| "Job" : "Market county: changed by job"
  "Property (area)" }o--o| "App user" : "Measurement: changed by user ID"
  "Property (area)" }o--o| "App user" : "Measurement: changed for user ID"
  "Property (area)" }o--o| "Job" : "Measurement: changed by job"
  "People (area)" }o--o| "App user" : "Merged party: changed by user ID"
  "People (area)" }o--o| "App user" : "Merged party: changed for user ID"
  "People (area)" }o--o| "Job" : "Merged party: changed by job"
  "Clients (area)" }o--o| "App user" : "National account: changed by user ID"
  "Clients (area)" }o--o| "App user" : "National account: changed for user ID"
  "Clients (area)" }o--o| "Job" : "National account: changed by job"
  "Clients (area)" }o--o| "App user" : "National account owner: changed by user ID"
  "Clients (area)" }o--o| "App user" : "National account owner: changed for user ID"
  "Clients (area)" }o--o| "App user" : "National account owner: owner ID, owner is partner"
  "Clients (area)" }o--o| "Job" : "National account owner: changed by job"
  "Activity (area)" }o--o| "App user" : "Next step: changed by user ID"
  "Activity (area)" }o--o| "App user" : "Next step: changed for user ID"
  "Activity (area)" }o--o| "Job" : "Next step: changed by job"
  "Offers (area)" }o--o| "App user" : "Offer: changed by user ID"
  "Offers (area)" }o--o| "App user" : "Offer: changed for user ID"
  "Offers (area)" }o--o| "Job" : "Offer: changed by job"
  "Offers (area)" }o--o| "App user" : "Offer claim: changed by user ID"
  "Offers (area)" }o--o| "App user" : "Offer claim: changed for user ID"
  "Offers (area)" }o--o| "Job" : "Offer claim: changed by job"
  "Offers (area)" }o--o| "App user" : "Offer document: changed by user ID"
  "Offers (area)" }o--o| "App user" : "Offer document: changed for user ID"
  "Offers (area)" }o--o| "Job" : "Offer document: changed by job"
  "People (area)" }o--o| "App user" : "Outside ID: changed by user ID"
  "People (area)" }o--o| "App user" : "Outside ID: changed for user ID"
  "People (area)" }o--o| "Job" : "Outside ID: changed by job"
  "People (area)" }o--o| "App user" : "Party: changed by user ID"
  "People (area)" }o--o| "App user" : "Party: changed for user ID"
  "People (area)" }o--o| "Job" : "Party: changed by job"
  "People (area)" }o--o| "App user" : "Party company: changed by user ID"
  "People (area)" }o--o| "App user" : "Party company: changed for user ID"
  "People (area)" }o--o| "Job" : "Party company: changed by job"
  "Documents (area)" }o--o| "App user" : "Party document: changed by user ID"
  "Documents (area)" }o--o| "App user" : "Party document: changed for user ID"
  "Documents (area)" }o--o| "Job" : "Party document: changed by job"
  "People (area)" }o--o| "App user" : "Party email: changed by user ID"
  "People (area)" }o--o| "App user" : "Party email: changed for user ID"
  "People (area)" }o--o| "Job" : "Party email: changed by job"
  "Relationships (area)" }o--o| "App user" : "Party link: changed by user ID"
  "Relationships (area)" }o--o| "App user" : "Party link: changed for user ID"
  "Relationships (area)" }o--o| "Job" : "Party link: changed by job"
  "People (area)" }o--o| "App user" : "Party phone: changed by user ID"
  "People (area)" }o--o| "App user" : "Party phone: changed for user ID"
  "People (area)" }o--o| "Job" : "Party phone: changed by job"
  "Relationships (area)" }o--o| "App user" : "Party role: changed by user ID"
  "Relationships (area)" }o--o| "App user" : "Party role: changed for user ID"
  "Relationships (area)" }o--o| "App user" : "Party role: owner user ID"
  "Relationships (area)" }o--o| "Job" : "Party role: changed by job"
  "Relationships (area)" }o--o| "App user" : "Party specialty: changed by user ID"
  "Relationships (area)" }o--o| "App user" : "Party specialty: changed for user ID"
  "Relationships (area)" }o--o| "Job" : "Party specialty: changed by job"
  "Vendors and territories (area)" }o--o| "App user" : "Party territory: changed by user ID"
  "Vendors and territories (area)" }o--o| "App user" : "Party territory: changed for user ID"
  "Vendors and territories (area)" }o--o| "Job" : "Party territory: changed by job"
  "Vendors and territories (area)" }o--o| "App user" : "Party territory review: changed by user ID"
  "Vendors and territories (area)" }o--o| "App user" : "Party territory review: changed for user ID"
  "Vendors and territories (area)" }o--o| "App user" : "Party territory review: reviewed by user ID"
  "Vendors and territories (area)" }o--o| "App user" : "Party territory review: reviewed for user ID"
  "Vendors and territories (area)" }o--o| "Job" : "Party territory review: changed by job"
  "Vendors and territories (area)" }o--o| "Job" : "Party territory review: reviewed by job"
  "Deals (area)" }o--o| "App user" : "Phase: changed by user ID"
  "Deals (area)" }o--o| "App user" : "Phase: changed for user ID"
  "Deals (area)" }o--o| "Job" : "Phase: changed by job"
  "Marketing posts (area)" }o--o| "App user" : "Post: changed by user ID"
  "Marketing posts (area)" }o--o| "App user" : "Post: changed for user ID"
  "Marketing posts (area)" }o--o| "Job" : "Post: changed by job"
  "Marketing posts (area)" }o--o| "App user" : "Post media: changed by user ID"
  "Marketing posts (area)" }o--o| "App user" : "Post media: changed for user ID"
  "Marketing posts (area)" }o--o| "Job" : "Post media: changed by job"
  "Marketing review (area)" }o--o| "App user" : "Post review: changed by user ID"
  "Marketing review (area)" }o--o| "App user" : "Post review: changed for user ID"
  "Marketing review (area)" }o--o| "Job" : "Post review: changed by job"
  "Marketing review (area)" }o--o| "App user" : "Post text: changed by user ID"
  "Marketing review (area)" }o--o| "App user" : "Post text: changed for user ID"
  "Marketing review (area)" }o--o| "Job" : "Post text: changed by job"
  "Property (area)" }o--o| "App user" : "Property: changed by user ID"
  "Property (area)" }o--o| "App user" : "Property: changed for user ID"
  "Property (area)" }o--o| "Job" : "Property: changed by job"
  "Offers (area)" }o--o| "App user" : "Proposal: changed by user ID"
  "Offers (area)" }o--o| "App user" : "Proposal: changed for user ID"
  "Offers (area)" }o--o| "App user" : "Proposal: decided by user ID"
  "Offers (area)" }o--o| "Job" : "Proposal: changed by job"
  "Offers (area)" }o--|| "Job" : "Proposal: proposed by job"
  "Email (area)" }o--o| "App user" : "Reply draft: changed by user ID"
  "Email (area)" }o--o| "App user" : "Reply draft: changed for user ID"
  "Email (area)" }o--|| "App user" : "Reply draft: owner user ID"
  "Email (area)" }o--o| "Job" : "Reply draft: changed by job"
  "Email (area)" }o--o| "Job" : "Reply draft: proposed by job"
  "Email (area)" }o--o| "App user" : "Reply draft document: changed by user ID"
  "Email (area)" }o--o| "App user" : "Reply draft document: changed for user ID"
  "Email (area)" }o--o| "Job" : "Reply draft document: changed by job"
  "Relationships (area)" }o--o| "App user" : "Role: changed by user ID"
  "Relationships (area)" }o--o| "App user" : "Role: changed for user ID"
  "Relationships (area)" }o--o| "Job" : "Role: changed by job"
  "Social accounts (area)" }o--o| "App user" : "Social account: changed by user ID"
  "Social accounts (area)" }o--o| "App user" : "Social account: changed for user ID"
  "Social accounts (area)" }o--o| "Job" : "Social account: changed by job"
  "Social accounts (area)" }o--|| "App user" : "Social sign in: signed in by user ID"
  "Property (area)" }o--o| "App user" : "Space need: changed by user ID"
  "Property (area)" }o--o| "App user" : "Space need: changed for user ID"
  "Property (area)" }o--o| "Job" : "Space need: changed by job"
  "Relationships (area)" }o--o| "App user" : "Specialty: changed by user ID"
  "Relationships (area)" }o--o| "App user" : "Specialty: changed for user ID"
  "Relationships (area)" }o--o| "Job" : "Specialty: changed by job"
  "Deals (area)" }o--o| "App user" : "Stage: changed by user ID"
  "Deals (area)" }o--o| "App user" : "Stage: changed for user ID"
  "Deals (area)" }o--o| "Job" : "Stage: changed by job"
  "Property (area)" }o--o| "App user" : "Suite: changed by user ID"
  "Property (area)" }o--o| "App user" : "Suite: changed for user ID"
  "Property (area)" }o--o| "Job" : "Suite: changed by job"
  "Vendors and territories (area)" }o--o| "App user" : "Territory: changed by user ID"
  "Vendors and territories (area)" }o--o| "App user" : "Territory: changed for user ID"
  "Vendors and territories (area)" }o--o| "Job" : "Territory: changed by job"
  "Vendors and territories (area)" }o--o| "App user" : "Territory piece: changed by user ID"
  "Vendors and territories (area)" }o--o| "App user" : "Territory piece: changed for user ID"
  "Vendors and territories (area)" }o--o| "Job" : "Territory piece: changed by job"
  "Tours (area)" }o--o| "App user" : "Tour plan: changed by user ID"
  "Tours (area)" }o--o| "App user" : "Tour plan: changed for user ID"
  "Tours (area)" }o--o| "Job" : "Tour plan: changed by job"
  "Tours (area)" }o--o| "App user" : "Tour stop: changed by user ID"
  "Tours (area)" }o--o| "App user" : "Tour stop: changed for user ID"
  "Tours (area)" }o--o| "Job" : "Tour stop: changed by job"
  "Deals (area)" }o--o| "App user" : "Typical length: changed by user ID"
  "Deals (area)" }o--o| "App user" : "Typical length: changed for user ID"
  "Deals (area)" }o--o| "Job" : "Typical length: changed by job"
  "Changes and preferences (area)" }o--o| "App user" : "User preference: changed by user ID"
  "Changes and preferences (area)" }o--o| "App user" : "User preference: changed for user ID"
  "Changes and preferences (area)" |o--|| "App user" : "User preference: user ID"
  "Changes and preferences (area)" }o--o| "Job" : "User preference: changed by job"
  "Vendors and territories (area)" }o--o| "App user" : "Vendor loan program: changed by user ID"
  "Vendors and territories (area)" }o--o| "App user" : "Vendor loan program: changed for user ID"
  "Vendors and territories (area)" }o--o| "Job" : "Vendor loan program: changed by job"
  "Vendors and territories (area)" }o--o| "App user" : "Vendor vertical: changed by user ID"
  "Vendors and territories (area)" }o--o| "App user" : "Vendor vertical: changed for user ID"
  "Vendors and territories (area)" }o--o| "Job" : "Vendor vertical: changed by job"
  "Home and calendar (area)" }o--o| "App user" : "Weekly review: changed by user ID"
  "Home and calendar (area)" }o--o| "App user" : "Weekly review: changed by user ID, reviewer is partner"
  "Home and calendar (area)" }o--o| "App user" : "Weekly review: changed for user ID"
  "Home and calendar (area)" }o--o| "Job" : "Weekly review: changed by job"
```

## Connects to

Numbers count foreign keys between the two areas.

[Activity](viewpoint-activity.md) (12) · [Changes and preferences](viewpoint-changes-preferences.md) (10) · [Client websites](viewpoint-website.md) (4) · [Clients](viewpoint-clients.md) (26) · [Commissions](viewpoint-commissions.md) (14) · [Deals](viewpoint-deals.md) (26) · [Doc](viewpoint-doc.md) (3) · [Documents](viewpoint-documents.md) (12) · [Email](viewpoint-email.md) (21) · [Home and calendar](viewpoint-home-calendar.md) (20) · [Imported deals](viewpoint-imported-deals.md) (15) · [Invoices](viewpoint-invoices.md) (6) · [Leads](viewpoint-leads.md) (15) · [Leases](viewpoint-leases.md) (17) · [Marketing categories](viewpoint-marketing-categories.md) (6) · [Marketing posts](viewpoint-marketing-posts.md) (6) · [Marketing review](viewpoint-marketing-review.md) (6) · [Offers](viewpoint-offers.md) (14) · [People](viewpoint-people.md) (22) · [Property](viewpoint-property.md) (18) · [Relationships](viewpoint-relationships.md) (26) · [Social accounts](viewpoint-social-accounts.md) (4) · [Tours](viewpoint-tours.md) (6) · [Vendors and territories](viewpoint-vendors-territories.md) (30)

## Tables

- [App user](next.app_user.md)
- [Job](next.job.md)

See each table for its columns and links to other areas.
