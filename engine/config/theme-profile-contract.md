Write exactly one UTF-8 JSON file named theme-profile.json in the current directory.

The JSON object has exactly these properties: softwareName, purpose, industry,
entityAliases, moduleAliases, seedVocabulary. Use only the entity and module IDs
listed in the prompt. Values are short plain display text for the requested theme.

seedVocabulary MUST be a JSON object, never an array. Each property name is a
lower_snake_case vocabulary category and each value is a non-empty array of
unique short strings. Valid shape example: `"seedVocabulary":{"sample_names":["Example Name"]}`.
Use `{}` when no seed vocabulary customization is needed.

Do not add applicant identity, contact, credential, ownership, publication, URL,
HTML, Markdown link, filesystem path, script, SQL, command, expression, stable ID,
field, permission, transition, migration or executable content. Do not read or
write any other path. Do not create any other file.
