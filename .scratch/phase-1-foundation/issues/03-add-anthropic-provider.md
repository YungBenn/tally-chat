# 03: Add an Anthropic provider

**What to build:** The owner adds an Anthropic provider with a name, base URL and API key. The key is tested with one cheap call, encrypted at rest with a master key from the environment, and never shown again. The provider's model list is pulled and editable. Spec: user stories 6 to 13; Implementation Decisions "Key vault" and "Provider layer".

**Blocked by:** 01 Scaffold and owner login

**Status:** ready-for-agent

- [ ] Owner can add a provider with name, API style `anthropic`, base URL and key
- [ ] Non-https base URLs are refused (the full URL guard lands in 04)
- [ ] Saving runs one cheap test call; a bad key is reported and nothing is saved
- [ ] A saved provider shows its detected provider identity and key status, never key material
- [ ] Key is stored encrypted with a master key from an environment variable; the database holds only ciphertext
- [ ] Tests prove no client-facing query or mutation returns key material, and request headers are never logged
- [ ] Model list is pulled from the provider on save and the owner can hide or edit entries
- [ ] Owner can replace a key or delete a provider
- [ ] The add-provider form explains that ChatGPT Plus or Claude Pro subscriptions are not API keys
