# Сторонние skills

Пакет содержит 12 сторонних skills. Их авторские права принадлежат указанным
авторам. Полные условия лежат в `LICENSE.txt` внутри каждой устанавливаемой
папки; лицензия корневого пакета их не заменяет.

| Skills | Источник | Лицензия |
| --- | --- | --- |
| product-marketing-context, content-strategy, seo-audit, ai-seo, copy-editing | [Corey Haines — marketingskills](https://github.com/coreyhaines31/marketingskills) | MIT, Copyright © 2025 Corey Haines |
| content-research-writer | [ComposioHQ — awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills/tree/be2a406907dbc61b73e6827ded415c96139d13a2/content-research-writer) | Apache-2.0, по [заявлению в README](https://github.com/ComposioHQ/awesome-claude-skills/blob/be2a406907dbc61b73e6827ded415c96139d13a2/README.md#license); отдельного исключения у этого skill нет |
| seo-content-brief, seo-content | [AgriciDaniel — claude-seo](https://github.com/AgriciDaniel/claude-seo/tree/4b99de2f7de7e7d5247042e5fb5b4ea9368ef734) | MIT, полный copyright сохранён в LICENSE.txt |
| english-humanizer | [kambleakash0 — agent-skills](https://github.com/kambleakash0/agent-skills) | MIT, полный copyright сохранён в LICENSE.txt |
| humanizer-ru | [vladimir-human — humanizer-ru](https://github.com/vladimir-human/humanizer-ru) | MIT, полный copyright сохранён в LICENSE.txt |
| webapp-testing | [Anthropic — skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/webapp-testing) | Apache-2.0, Copyright © 2026 Anthropic, PBC. |
| astro-framework | [delineas — astro-framework-agents](https://github.com/delineas/astro-framework-agents/tree/3e32c91cc433424e162472b81afaa5e9324669bb/skills/astro-framework), найден на [skills.sh](https://skills.sh/delineas/astro-framework-agents/astro-framework) | MIT, Copyright © 2025 Daniel |

## Снимки и изменения

Точные файлы и SHA-256 перечислены в `skills-lock.json`. Для локальных skills
поле `revision` обозначает снимок включённых файлов. Указанный в provenance
upstream commit использован для проверки происхождения и лицензии; он не
объявляется точной ревизией локальной установки. Для Astro и seo-content
источником служит конкретный upstream commit.

Изменения при включении:

- Исключены CI, evals, README, git metadata и прочие файлы, не нужные для работы
  skill. Ресурсы, на которые ссылаются инструкции, сохранены. Symlink заменены
  содержимым файлов.
- В content-strategy три ссылки на отсутствующие интеграции заменены официальной
  документацией CMS. В ai-seo ссылка на отсутствующий registry заменена указанием
  проверять доступные инструменты и документацию провайдера.
- seo-content взят из MIT-проекта claude-seo. Пути к двум E-E-A-T справочникам
  перенесены внутрь skill. Вызовы необязательных plugin CLI заменены переносимыми
  указаниями по редактуре и проверке официальных источников; ссылка на внешний
  plugin seo-geo заменена первичной документацией Google. Команды необязательного
  FLOW plugin заменены редакторской проверкой через включённые skills.
- Добавлены полные LICENSE.txt. У content-research-writer также сохранено
  заявление upstream README о лицензировании; текст Apache-2.0 взят из полного
  стандартного текста с незаполненным примером copyright, без приписывания
  авторства Anthropic этому skill.

Локальная версия seo-content из codex-seo **не включена**: корневая лицензия
исследованной ревизии запрещает распространение, несмотря на поле MIT внутри
skill. Её файлы и справочники не используются в этом пакете.

Внешние Python helpers — исходники для проверки по запросу агента. Установщик
не выполняет их и не устанавливает Python, Playwright, браузеры или MCP-серверы.
