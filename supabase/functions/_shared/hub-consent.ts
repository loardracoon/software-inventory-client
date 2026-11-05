// The consent an admin gives before asking the Sophizo Hub for access (phase 10c). Shared by the Settings card
// (alias @hub-consent) and the hub-enroll function, so the text shown and the version recorded always match.
// Change the text → change the version: the Hub stores the version each requester agreed to.

export const SOPHIZO_HUB_URL = "https://mcs.sophizo.com.br";
export const CONSENT_VERSION = "2026-11-04";

export const CONSENT_TITLE = "Data sent to the Hub and to third-party AI";
export const CONSENT_TEXT =
  "When this installation is connected to mcs.sophizo.com.br, it sends the details of software titles the Hub does not know " +
  "yet: name, vendor, description, type and OS family. The Hub can send these details to third-party AI models (for example " +
  "Google Gemini, OpenAI or Anthropic Claude) to classify them. Hostnames, users, installed versions and counts are never sent. " +
  "No SLA is defined for this Hub: it is provided as is, as a personal project.";
export const CONSENT_CHECKBOX = "I agree that application information is sent to the Hub and processed by third-party AI models.";
