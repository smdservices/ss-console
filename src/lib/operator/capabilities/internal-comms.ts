/**
 * InternalComms capability — Slack / Teams channel posts, DMs,
 * mentions.
 *
 * Per ADR 0005, INTERNAL destinations are persona-visible: posts come
 * from the named persona as the customer's internal teammate.
 * External destinations remain draft-for-review external send (Email). This
 * interface is for internal-only surfaces; adapters MUST refuse to
 * post to any channel that has external members or guests.
 *
 * Implemented by adapters for Slack and Microsoft Teams. Other
 * internal-comms platforms (Discord, Mattermost, etc.) are
 * theoretically addable but not on the v1 roadmap.
 */

import type { AdapterBase, DateRange } from './types'

// ---------------------------------------------------------------------------
// Channels and messages
// ---------------------------------------------------------------------------

export interface ChannelSummary {
  id: string
  name: string
  /** Whether the channel is private. */
  is_private: boolean
  /** Whether the channel has any external members or guests.
   * Adapters MUST refuse posts to external channels. */
  has_external_members: boolean
  /** Number of members. Adapters may return null when expensive to
   * compute. */
  member_count: number | null
}

export interface ChannelMessage {
  id: string
  channel_id: string
  thread_id: string | null
  /** Author of the message. May be the persona, a human teammate, or
   * a system bot. */
  author: {
    /** Email when available; the persona's AgentMail address when
     * the persona is the author. */
    email: string | null
    display_name: string
    /** Whether this is the AI persona itself. */
    is_persona: boolean
  }
  /** Plain-text body. Adapters MAY also surface a structured-blocks
   * representation in `blocks`. */
  body_text: string
  /** Vendor-specific structured representation (Slack blocks, Teams
   * adaptive cards). Adapters that don't support structured posts
   * return null. */
  blocks: unknown
  /** ISO 8601 timestamp. */
  posted_at: string
  /** ISO 8601 timestamp of the last edit. Null when never edited. */
  edited_at: string | null
}

export interface ListChannelMessagesQuery {
  channel_id: string
  /** Thread filter. When set, returns only messages in this thread. */
  thread_id?: string
  date_range?: DateRange
  /** Free-text search within the channel. */
  search?: string
  limit?: number
  cursor?: string
}

// ---------------------------------------------------------------------------
// Post operations — persona-as-sender for internal destinations
// ---------------------------------------------------------------------------

export interface PostToChannelInput {
  channel_id: string
  body_text: string
  /** Optional structured blocks. Adapters that don't support them
   * fall back to body_text only. */
  blocks?: unknown
  /** When set, posts as a reply in this thread. */
  thread_id?: string
  /** Skill that authored the post. Audit-required. */
  drafted_by_skill: string
  /** Matter correlation. */
  matter_ref?: string | null
}

export interface SendDmInput {
  /** Recipient's email or vendor-specific user identifier. Must
   * resolve to an internal teammate; adapters MUST refuse external
   * users. */
  recipient: string
  body_text: string
  blocks?: unknown
  drafted_by_skill: string
}

export interface PostRef {
  id: string
  channel_id: string | null
  thread_id: string | null
  /** Where the post appears in the vendor UI (for the dashboard's
   * "where Marcus posted" surface). */
  vendor_permalink: string | null
  posted_at: string
}

// ---------------------------------------------------------------------------
// Reactions and mentions
// ---------------------------------------------------------------------------

export interface ReactionInput {
  message_id: string
  /** Vendor-specific reaction key (e.g. ":thumbsup:", "approved"). */
  reaction: string
  drafted_by_skill: string
}

export interface Mention {
  message_id: string
  channel_id: string
  thread_id: string | null
  /** Who was mentioned. The persona's AgentMail or vendor user ID
   * appears here when the persona was mentioned. */
  mentioned: {
    email: string | null
    display_name: string
    is_persona: boolean
  }
  /** ISO 8601 timestamp of the message containing the mention. */
  posted_at: string
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface InternalComms extends AdapterBase {
  // Channel discovery
  list_channels(): Promise<ChannelSummary[]>

  // Read
  list_channel_messages(query: ListChannelMessagesQuery): Promise<ChannelMessage[]>
  get_message(message_id: string): Promise<ChannelMessage | null>

  /**
   * List recent mentions of the persona across all channels the
   * adapter can see. The intake-style "Marcus, can you...?" surface
   * polls this; the customer.yaml scope envelope governs which
   * channels are visible.
   */
  list_recent_mentions(since: string): Promise<Mention[]>

  /**
   * Post as the persona. Per ADR 0005, internal destinations are
   * persona-visible: the message appears authored by the named
   * persona, not the reviewer. Adapters MUST refuse to post to any
   * channel where `has_external_members` is true.
   */
  post_to_channel(input: PostToChannelInput): Promise<PostRef>

  /** Send a DM to an internal teammate as the persona. Adapters MUST
   * refuse external recipients. */
  send_dm(input: SendDmInput): Promise<PostRef>

  /** React to a message. Used by skills like inbox-triage to ack a
   * partner's question without composing a full reply. */
  react_to_message(input: ReactionInput): Promise<void>

  /** Channels the customer.yaml scope envelope makes readable. */
  get_scoped_channels(): string[]
}
