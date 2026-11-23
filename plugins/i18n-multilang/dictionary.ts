// 多语言词典 v1.1 —— 单表四列，构建时保证四语键集一致。
// ------------------------------------------------------------------
// 翻译策略（两层）：
//  1. 整句精确匹配：界面文案整句收录（≤120 字符）；
//  2. 分段翻译：未整句命中时，把文本按「连续 CJK 段」切分，逐段查词典，
//     数字 / 变量 / 用户数据原样保留 —— 于是「2 位成员 · 1 个项目」
//     「待办 1 · 进行中 0」「11月23日星期一」这类动态文案也能翻译。
// 另配正则规则（RULES）处理中文日期（2026年11月23日星期一）与量词（3 个→3）。
// 用户数据（项目名、任务标题、人名、消息正文、文档内容）不收录、不翻译。
export type Locale = "en" | "ja" | "fr" | "ru";

export const LOCALES: { code: Locale | "zh"; label: string; native: string }[] = [
  { code: "zh", label: "中文", native: "简体中文" },
  { code: "en", label: "English", native: "English" },
  { code: "ja", label: "日语", native: "日本語" },
  { code: "fr", label: "法语", native: "Français" },
  { code: "ru", label: "俄语", native: "Русский" },
];

/** [原文, en, ja, fr, ru] */
type Row = readonly [string, string, string, string, string];

const ROWS: readonly Row[] = [
  // ---- A. 通用导航与操作 ----
  ["首页", "Home", "ホーム", "Accueil", "Главная"],
  ["工作台", "Workspace", "ワークスペース", "Espace de travail", "Рабочее пространство"],
  ["项目", "Projects", "プロジェクト", "Projets", "Проекты"],
  ["团队", "Teams", "チーム", "Équipes", "Команды"],
  ["文档", "Docs", "ドキュメント", "Docs", "Документы"],
  ["任务", "tasks", "タスク", "tâches", "задачи"],
  ["迭代", "sprint", "スプリント", "sprint", "спринт"],
  ["登录", "Log in", "ログイン", "Connexion", "Вход"],
  ["注册", "Sign up", "新規登録", "Inscription", "Регистрация"],
  ["注册登录", "Sign up / Log in", "登録 / ログイン", "Inscription / Connexion", "Регистрация / Вход"],
  ["退出登录", "Log out", "ログアウト", "Déconnexion", "Выйти"],
  ["退出用户", "Sign out", "ログアウト", "Déconnexion", "Выйти"],
  ["进入工作台", "Open workspace", "ワークスペースへ", "Entrer dans l'espace", "Открыть пространство"],
  ["进入工作台 →", "Open workspace →", "ワークスペースへ →", "Entrer →", "Открыть →"],
  ["进入", "Open", "開く", "Ouvrir", "Открыть"],
  ["返回首页", "Back to home", "ホームへ戻る", "Retour à l'accueil", "На главную"],
  ["← 返回工作台", "← Back to workspace", "← ワークスペースへ戻る", "← Retour à l'espace", "← Назад в пространство"],
  ["个人设置", "Settings", "設定", "Paramètres", "Настройки"],
  ["个人设置 /", "Settings /", "設定 /", "Paramètres /", "Настройки /"],
  ["主导航", "Main navigation", "メインナビ", "Navigation principale", "Главная навигация"],
  ["项目分区", "Project tabs", "プロジェクトタブ", "Onglets du projet", "Разделы проекта"],
  ["工作空间", "Workspace", "ワークスペース", "Espace", "Пространство"],
  ["今日视图", "Today view", "今日ビュー", "Vue du jour", "Обзор дня"],
  ["确认", "Confirm", "確認", "Confirmer", "Подтвердить"],
  ["取消", "Cancel", "キャンセル", "Annuler", "Отмена"],
  ["保存", "Save", "保存", "Enregistrer", "Сохранить"],
  ["保存修改", "Save changes", "変更を保存", "Enregistrer", "Сохранить изменения"],
  ["关闭", "Close", "閉じる", "Fermer", "Закрыть"],
  ["刷新", "Refresh", "更新", "Actualiser", "Обновить"],
  ["添加", "Add", "追加", "Ajouter", "Добавить"],
  ["删除", "Delete", "削除", "Supprimer", "Удалить"],
  ["编辑", "Edit", "編集", "Modifier", "Изменить"],
  ["重命名", "Rename", "名前変更", "Renommer", "Переименовать"],
  ["移动", "Move", "移動", "Déplacer", "Переместить"],
  ["复制", "Copy", "コピー", "Copier", "Копировать"],
  ["下载", "Download", "ダウンロード", "Télécharger", "Скачать"],
  ["上传", "Upload", "アップロード", "Téléverser", "Загрузить"],
  ["分享", "Share", "共有", "Partager", "Поделиться"],
  ["搜索", "Search", "検索", "Rechercher", "Поиск"],
  ["选择", "Select", "選択", "Sélectionner", "Выбрать"],
  ["显示", "Showing", "表示", "Affichage", "Показано"],
  ["全部", "All", "すべて", "Tout", "Все"],
  ["全部项目", "All projects", "すべてのプロジェクト", "Tous les projets", "Все проекты"],
  ["其他", "Other", "その他", "Autre", "Другое"],
  ["语言", "Language", "言語", "Langue", "Язык"],
  ["版本", "Version", "バージョン", "Version", "Версия"],
  ["作者", "Author", "作者", "Auteur", "Автор"],
  ["权限", "Permissions", "権限", "Permissions", "Права"],
  ["名称", "Name", "名称", "Nom", "Название"],
  ["展开", "Expand", "展開", "Déplier", "Развернуть"],
  ["收起", "Collapse", "折りたたむ", "Replier", "Свернуть"],
  ["展开子菜单", "Expand submenu", "サブメニューを展開", "Déplier le sous-menu", "Развернуть подменю"],
  ["查看", "View", "表示", "Voir", "Просмотр"],
  ["查看全部", "View all", "すべて表示", "Tout voir", "Показать все"],
  ["查看团队管理", "View team management", "チーム管理を見る", "Voir les équipes", "К управлению командами"],
  ["查看项目管理", "View project management", "プロジェクト管理を見る", "Voir les projets", "К управлению проектами"],
  ["查看我的待办", "View my to-dos", "マイToDoを見る", "Voir mes à-faire", "К моим задачам"],
  ["上一步", "Previous", "前へ", "Précédent", "Назад"],
  ["下一步", "Next", "次へ", "Suivant", "Далее"],
  ["＋ 新建任务", "+ New task", "＋ 新規タスク", "＋ Nouvelle tâche", "＋ Новая задача"],
  ["＋ 创建迭代", "+ New sprint", "＋ スプリント作成", "＋ Nouveau sprint", "＋ Новый спринт"],
  ["新建任务", "New task", "新規タスク", "Nouvelle tâche", "Новая задача"],
  ["新建文档", "New doc", "新規ドキュメント", "Nouveau document", "Новый документ"],
  ["创建迭代", "New sprint", "スプリント作成", "Nouveau sprint", "Новый спринт"],
  ["建项目迭代", "Create sprint", "スプリント作成", "Créer un sprint", "Создать спринт"],
  ["暂无数据", "No data", "データなし", "Aucune donnée", "Нет данных"],
  ["暂无迭代", "No sprints", "スプリントなし", "Aucun sprint", "Нет спринтов"],
  ["暂无进行中的迭代", "No active sprint", "進行中のスプリントなし", "Aucun sprint actif", "Нет активного спринта"],
  ["加载中…", "Loading…", "読み込み中…", "Chargement…", "Загрузка…"],
  ["正在加载工作空间…", "Loading workspace…", "ワークスペースを読み込み中…", "Chargement de l'espace…", "Загрузка пространства…"],
  ["跳过，直接进工作台 →", "Skip, straight to workspace →", "スキップしてワークスペースへ →", "Passer, aller à l'espace →", "Пропустить, к пространству →"],

  // ---- B. 左栏 / 工作台 / 任务看板 ----
  ["通知", "Notifications", "通知", "Notifications", "Уведомления"],
  ["待办", "To-dos", "ToDo", "À faire", "Задачи"],
  ["私信", "Messages", "メッセージ", "Messages", "Сообщения"],
  ["私聊", "DMs", "DM", "Messages privés", "Личные"],
  ["云文档", "Cloud Docs", "クラウド文書", "Docs cloud", "Облако документов"],
  ["项目管理", "Project Mgmt", "プロジェクト管理", "Gestion projets", "Проекты"],
  ["团队管理", "Team Mgmt", "チーム管理", "Gestion équipes", "Команды"],
  ["项目管理页", "Projects page", "プロジェクト管理", "Page projets", "Страница проектов"],
  ["团队管理页", "Teams page", "チーム管理", "Page équipes", "Страница команд"],
  ["新手导引", "Quick guide", "はじめに", "Guide", "Гид"],
  ["插件", "Plugins", "プラグイン", "Extensions", "Плагины"],
  ["导引", "Guide", "ガイド", "Guide", "Гид"],
  ["插件商城", "Plugin Store", "プラグインストア", "Boutique de plugins", "Магазин плагинов"],
  ["效率中心", "Productivity", "効率センター", "Productivité", "Продуктивность"],
  ["打开效率中心", "Open productivity center", "効率センターを開く", "Ouvrir la productivité", "Открыть продуктивность"],
  ["效率中心 · 日历 / 待办 / 记事（Ctrl+点击 新标签页打开）", "Productivity · Calendar / To-dos / Notes (Ctrl+click for new tab)", "効率センター · カレンダー / ToDo / メモ（Ctrl+クリックで新規タブ）", "Productivité · Calendrier / À faire / Notes (Ctrl+clic, nouvel onglet)", "Продуктивность · Календарь / Задачи / Заметки (Ctrl+клик — новая вкладка)"],
  ["今日 · 进度 / AI 日报 / 日历", "Today · progress / AI brief / calendar", "今日 · 進捗 / AI 日報 / カレンダー", "Aujourd'hui · avancement / brief IA / calendrier", "Сегодня · прогресс / ИИ-сводка / календарь"],
  ["切换日间模式", "Switch to light mode", "ライトモードへ切替", "Passer en mode clair", "Светлая тема"],
  ["切换夜间模式", "Switch to dark mode", "ダークモードへ切替", "Passer en mode sombre", "Тёмная тема"],
  ["项目任务", "Tasks", "タスク", "Tâches", "Задачи"],
  ["团队聊天", "Team Chat", "チームチャット", "Chat d'équipe", "Чат команды"],
  ["项目概览", "Overview", "概要", "Aperçu", "Обзор"],
  ["项目文档", "Docs", "ドキュメント", "Documents", "Документы"],
  ["团队资料", "Team Library", "チームライブラリ", "Bibliothèque d'équipe", "Библиотека команды"],
  ["我的任务", "My tasks", "マイタスク", "Mes tâches", "Мои задачи"],
  ["我的待办", "My to-dos", "マイToDo", "Mes à-faire", "Мои задачи"],
  ["我的工作空间", "My workspace", "マイワークスペース", "Mon espace", "Моё пространство"],
  ["我的团队", "My teams", "マイチーム", "Mes équipes", "Мои команды"],
  ["已加入的团队", "Teams joined", "参加チーム", "Équipes rejointes", "Присоединённые команды"],
  ["列表", "List", "リスト", "Liste", "Список"],
  ["看板", "Board", "ボード", "Tableau", "Доска"],
  ["任务展示方式", "Task display", "タスク表示", "Affichage des tâches", "Вид задач"],
  ["任务快捷筛选", "Quick filters", "クイック絞り込み", "Filtres rapides", "Быстрые фильтры"],
  ["更多筛选", "More filters", "その他の絞り込み", "Plus de filtres", "Ещё фильтры"],
  ["我负责的", "Assigned to me", "担当タスク", "Assignées à moi", "Я отвечаю"],
  ["我协作的", "Collaborating", "協力タスク", "En collaboration", "Я соисполнитель"],
  ["今天截止", "Due today", "今日締め切り", "À rendre aujourd'hui", "Срок сегодня"],
  ["已逾期", "Overdue", "期限超過", "En retard", "Просрочено"],
  ["当前迭代", "Current sprint", "現在のスプリント", "Sprint en cours", "Текущий спринт"],
  ["当前迭代已结束", "Current sprint ended", "スプリント終了", "Sprint terminé", "Спринт завершён"],
  ["待开始", "To do", "未着手", "À faire", "К выполнению"],
  ["进行中", "In progress", "進行中", "En cours", "В работе"],
  ["进行中项目", "Active projects", "進行中プロジェクト", "Projets actifs", "Активные проекты"],
  ["进行中的项目", "Active projects", "進行中のプロジェクト", "Projets en cours", "Активные проекты"],
  ["活跃项目", "active projects", "進行中プロジェクト", "projets actifs", "активные проекты"],
  ["已完成", "Done", "完了", "Terminé", "Готово"],
  ["未完成", "not done", "未完了", "non terminé", "не завершено"],
  ["优先级", "Priority", "優先度", "Priorité", "Приоритет"],
  ["高", "High", "高", "Haute", "Высокий"],
  ["中", "Med", "中", "Moyenne", "Средний"],
  ["低", "Low", "低", "Basse", "Низкий"],
  ["负责人", "Owner", "担当者", "Responsable", "Владелец"],
  ["负责人：", "Owner: ", "担当者：", "Responsable : ", "Владелец: "],
  ["成员", "members", "メンバー", "membres", "участники"],
  ["管理成员", "Members", "メンバー管理", "Membres", "Участники"],
  ["未分配", "Unassigned", "未割り当て", "Non assigné", "Не назначен"],
  ["尚未分配负责人", "Unassigned owner", "担当者未割り当て", "Responsable non assigné", "Ответственный не назначен"],
  ["任务进度", "Task progress", "タスク進捗", "Avancement des tâches", "Прогресс задач"],
  ["进度", "progress", "進捗", "avancement", "прогресс"],
  ["个任务", "tasks", "個のタスク", "tâches", "задач"],
  ["位成员", "members", "名のメンバー", "membres", "участников"],
  ["共", "In total,", "合計", "Au total,", "Всего"],
  ["我的任务完成率", "my completion rate", "私のタスク達成率", "mon taux de finition", "моя готовность"],
  ["注意", "Note", "注意", "Note", "внимание"],
  ["任务已逾期", "tasks overdue", "件のタスクが期限超過", "tâches en retard", "задач просрочено"],
  ["你好", "Hello", "こんにちは", "Bonjour", "Привет"],
  ["小提示", "Tip", "ヒント", "Astuce", "Совет"],
  ["清晰而漂亮", "Clear and beautiful", "明快で美しい", "Clair et élégant", "Ясно и красиво"],
  ["做得", "done", "完了", "réalisés", "сделано"],
  ["的安排", "schedule", "の予定", "— programme", "— план"],
  ["背景", "Background", "背景", "Fond", "Фон"],
  ["进入个人设置", "Open settings", "設定を開く", "Ouvrir les paramètres", "Открыть настройки"],
  ["过滤当前项目的任务列表；Ctrl K 打开全局搜索", "Filter this project's tasks; Ctrl K opens global search", "このプロジェクトのタスクを絞り込み。Ctrl K でグローバル検索", "Filtre les tâches du projet ; Ctrl K pour la recherche globale", "Фильтр задач проекта; Ctrl K — глобальный поиск"],
  ["任务看板", "Task board", "タスクボード", "Tableau des tâches", "Доска задач"],
  ["查看任务看板", "View task board", "タスクボードを見る", "Voir le tableau", "Открыть доску"],
  ["进入任务看板", "Open task board", "タスクボードへ", "Ouvrir le tableau", "К доске задач"],
  ["去任务看板查看进度", "Check progress on the board", "ボードで進捗を確認", "Voir l'avancement au tableau", "Прогресс — на доске"],
  ["项目整体进度", "Overall progress", "プロジェクト全体進捗", "Avancement global", "Общий прогресс"],
  ["项目速览", "Project at a glance", "プロジェクト概略", "Projet en bref", "Сводка проекта"],
  ["项目进度与日志", "Progress & activity", "進捗とログ", "Avancement & journal", "Прогресс и журнал"],
  ["项目动态", "Project activity", "プロジェクト活動", "Activité du projet", "Активность проекта"],
  ["最新动态", "Latest activity", "最新の活動", "Dernières activités", "Последние события"],
  ["完整展开", "Fully expand", "すべて展開", "Tout déplier", "Развернуть полностью"],
  ["收起整个侧边栏", "Collapse the sidebar", "サイドバーを閉じる", "Replier le panneau", "Свернуть панель"],
  ["收起全部项目", "Collapse all projects", "すべて折りたたむ", "Replier tous les projets", "Свернуть все проекты"],
  ["展开项目", "Expand project", "プロジェクトを展開", "Déplier le projet", "Развернуть проект"],
  ["收藏项目", "Favorite project", "お気に入り", "Projet favori", "В избранное"],
  ["查找项目…", "Find projects…", "プロジェクトを検索…", "Rechercher un projet…", "Найти проект…"],
  ["搜索项目", "Search projects", "プロジェクト検索", "Rechercher des projets", "Поиск проектов"],
  ["搜索团队", "Search teams", "チーム検索", "Rechercher des équipes", "Поиск команд"],
  ["搜索团队…", "Search teams…", "チームを検索…", "Rechercher…", "Найти команду…"],
  ["搜索项目…", "Search projects…", "プロジェクトを検索…", "Rechercher…", "Найти проект…"],
  ["搜索标题或内容摘要…", "Search titles or summaries…", "タイトル・概要を検索…", "Titres ou résumés…", "Поиск по заголовкам…"],
  ["创建项目", "Create project", "プロジェクト作成", "Créer un projet", "Создать проект"],
  ["创建团队", "Create team", "チーム作成", "Créer une équipe", "Создать команду"],
  ["删除项目", "Delete project", "プロジェクト削除", "Supprimer le projet", "Удалить проект"],
  ["删除项目：", "Delete project: ", "プロジェクト削除：", "Supprimer : ", "Удалить проект: "],
  ["解散团队", "Disband team", "チーム解散", "Dissoudre l'équipe", "Распустить команду"],
  ["解散团队：", "Disband team: ", "チーム解散：", "Dissoudre : ", "Распустить: "],
  ["加入团队", "Join a team", "チームに参加", "Rejoindre une équipe", "Вступить в команду"],
  ["申请加入", "Request to join", "参加申請", "Demander à rejoindre", "Запрос на вступление"],
  ["通过邀请码加入团队", "Join via invite code", "招待コードで参加", "Rejoindre via code", "Войти по коду"],
  ["团队邀请码", "Team invite code", "チーム招待コード", "Code d'invitation", "Код приглашения"],
  ["16 位邀请码", "16-digit invite code", "16桁の招待コード", "Code à 16 caractères", "16-значный код"],
  ["邀请码", "invite code", "招待コード", "code d'invitation", "код приглашения"],
  ["输入负责人提供的邀请码，提交申请后等待审核。", "Enter the invite code from the team owner; your request waits for approval.", "担当者の招待コードを入力し、承認を待ちます。", "Saisissez le code du responsable ; votre demande attendra validation.", "Введите код от владельца команды; заявка ждёт подтверждения."],
  ["统一查看团队、管理成员与分工。", "Teams, members and division of work in one view.", "チーム・メンバー・分担を一括管理。", "Équipes, membres et répartition en un coup d'œil.", "Команды, участники и роли — в одном месте."],
  ["在这里创建、查看和删除课程项目。", "Create, view and delete course projects here.", "ここで課題プロジェクトを作成・確認・削除します。", "Créez, consultez et supprimez des projets de cours ici.", "Здесь можно создавать, просматривать и удалять проекты."],
  ["任务完成", "Tasks done", "完了タスク", "Tâches finies", "Задачи выполнены"],
  ["完成率", "Completion", "達成率", "Taux de finition", "Готовность"],
  ["去工作台处理", "Handle in workspace", "ワークスペースで処理", "Traiter dans l'espace", "Обработать в пространстве"],
  ["标记为已完成", "Mark as done", "完了にする", "Marquer terminé", "Отметить готовым"],
  ["移至", "moved to", "へ移動", "déplacé vers", "перенесено в"],
  ["点击查看详情", "Click for details", "クリックで詳細", "Cliquer pour détails", "Нажмите для деталей"],
  ["正在移动…", "Moving…", "移動中…", "Déplacement…", "Перемещение…"],
  ["条评论", "comments", "件のコメント", "commentaires", "комментариев"],
  ["评论", "comments", "コメント", "commentaires", "комментариев"],
  ["个附件", "attachments", "件の添付", "pièces jointes", "вложений"],
  ["附件", "attachments", "添付ファイル", "pièces jointes", "вложений"],
  ["事件", "events", "件の予定", "événements", "событий"],
  ["当前结果完成度", "Result completion", "結果の完成度", "Avancement des résultats", "Готовность результатов"],
  ["当前筛选结果完成比例", "Completion of filtered results", "絞り込み結果の完成比率", "Ratio des résultats filtrés", "Доля готового в выборке"],
  ["准备开始的工作", "Work ready to start", "開始待ちの作業", "Travail prêt à démarrer", "Работа к запуску"],
  ["正在推进的工作", "Work in progress", "進行中の作業", "Travail en cours", "Работа в процессе"],
  ["已确认完成的交付", "Confirmed deliverables", "確認済みの成果物", "Livrables confirmés", "Завершённые результаты"],

  // ---- C. 今日 / AI 日报 / 周报 / 日历 ----
  ["今日", "Today", "今日", "Aujourd'hui", "Сегодня"],
  ["早上好", "Good morning", "おはようございます", "Bonjour", "Доброе утро"],
  ["中午好", "Good afternoon", "こんにちは", "Bonjour", "Добрый день"],
  ["下午好", "Good afternoon", "こんにちは", "Bonjour", "Добрый день"],
  ["晚上好", "Good evening", "こんばんは", "Bonsoir", "Добрый вечер"],
  ["今天", "Today", "今日", "Aujourd'hui", "Сегодня"],
  ["昨天", "Yesterday", "昨日", "Hier", "Вчера"],
  ["明天", "Tomorrow", "明日", "Demain", "Завтра"],
  ["今日概览", "Today at a glance", "今日の概要", "Aujourd'hui en bref", "Итоги дня"],
  ["日历", "Calendar", "カレンダー", "Calendrier", "Календарь"],
  ["记事", "Notes", "メモ", "Notes", "Заметки"],
  ["回到本月", "This month", "今月へ", "Ce mois-ci", "Текущий месяц"],
  ["上个月", "Prev month", "前の月", "Mois précédent", "Прошлый месяц"],
  ["下个月", "Next month", "次の月", "Mois suivant", "Следующий месяц"],
  ["AI 日报", "AI Brief", "AI 日報", "Brief IA", "ИИ-сводка"],
  ["AI 周报", "AI Weekly", "AI 週報", "Hebdo IA", "ИИ-недельная"],
  ["AI 日报与日历", "AI Brief & Calendar", "AI 日報とカレンダー", "Brief IA & calendrier", "ИИ-сводка и календарь"],
  ["实时", "Live", "リアルタイム", "Direct", "Онлайн"],
  ["重新生成", "Regenerate", "再生成", "Régénérer", "Пересоздать"],
  ["重新生成日报", "Regenerate brief", "日報を再生成", "Régénérer le brief", "Пересоздать сводку"],
  ["收起日报", "Collapse", "折りたたむ", "Replier", "Свернуть"],
  ["展开全部", "Expand all", "すべて展開", "Tout déplier", "Развернуть всё"],
  ["还有", "+", "あと", "+", "+"],
  ["节", "sections", "節", "sections", "разделов"],
  ["建议优先处理", "Suggested focus", "優先対応推奨", "À traiter en priorité", "Приоритетные"],
  ["截止临近", "Due soon", "締め切り間近", "Échéances proches", "Скоро срок"],
  ["未读私信", "Unread DMs", "未読メッセージ", "MP non lus", "Непрочитанные"],
  ["未读通知", "unread notifications", "未読通知", "notifications non lues", "непрочитанных уведомлений"],
  ["未读", "Unread", "未読", "Non lu", "Непрочитано"],
  ["已读", "Read", "既読", "Lu", "Прочитано"],
  ["最近文档", "Recent docs", "最近のドキュメント", "Docs récents", "Недавние документы"],
  ["正在汇总今天的工作区数据…", "Collecting today's workspace data…", "今日のワークスペースデータを集計中…", "Collecte des données du jour…", "Собираем данные за сегодня…"],
  ["由 AgileCampus 智能助手基于工作区实时数据生成", "Generated by the AgileCampus assistant from live workspace data", "AgileCampus アシスタントがワークスペースの実データから生成", "Généré par l'assistant AgileCampus à partir des données en direct", "Сгенерировано ассистентом AgileCampus по живым данным"],
  ["由本地规则引擎基于近 7 天数据生成，内容不出本机。", "Generated locally from the last 7 days by a rules engine; data never leaves your machine.", "直近7日間のデータからローカルのルールエンジンで生成。データは端末外に出ません。", "Généré localement sur 7 jours par un moteur de règles ; rien ne quitte votre machine.", "Создано локально за 7 дней; данные не покидают устройство."],
  ["聚合近 7 天的项目动态、交付与消息", "A weekly digest of project activity, delivery and messages", "直近7日間の活動・成果・メッセージを集約", "Un résumé hebdo d'activité, livrables et messages", "Недельная сводка активности, результатов и сообщений"],
  ["今天和明天没有截止任务，节奏不错 👍", "Nothing due today or tomorrow — nice pace 👍", "今日・明日の締め切りなし。良いペースです 👍", "Rien à rendre aujourd'hui ni demain 👍", "Сегодня и завтра сроков нет — отличный темп 👍"],
  ["这一天没有截止任务或里程碑", "No tasks or milestones due this day", "この日に締め切りのタスク・マイルストーンはありません", "Aucune échéance ce jour", "В этот день сроков нет"],
  ["暂无进行中的任务，从待办里挑一个开始吧", "No tasks in progress — pick one from your to-dos", "進行中のタスクなし。ToDoから選びましょう", "Aucune tâche en cours — choisissez dans les à-faire", "Нет задач в работе — выберите из списка"],
  ["没有未读私信", "No unread DMs", "未読メッセージなし", "Aucun MP non lu", "Нет непрочитанных"],
  ["今天有", "Today:", "本日：", "Aujourd'hui :", "Сегодня:"],
  ["任务需要推进", "tasks to move forward", "のタスクを進める必要あり", "tâches à avancer", "задач требует внимания"],
  ["本迭代完成度", "Sprint completion", "スプリント達成率", "Avancement du sprint", "Готовность спринта"],
  ["剩余", "Remaining", "残り", "Restant", "Осталось"],
  ["逾期", "Overdue", "期限超過", "En retard", "Просрочено"],
  ["天", "days", "日", "jours", "дн."],
  ["约", "~", "約", "~", "~"],
  ["分钟看完", "min read", "分で読めます", "min de lecture", "мин чтения"],
  ["人参与", "participants", "人が参加", "participants", "участников"],
  ["更新于", "updated", "更新日時", "mis à jour", "обновлено"],
  ["状态为", "Status:", "状態：", "Statut :", "Статус:"],
  ["星期一", "Monday", "月曜日", "lundi", "понедельник"],
  ["星期二", "Tuesday", "火曜日", "mardi", "вторник"],
  ["星期三", "Wednesday", "水曜日", "mercredi", "среда"],
  ["星期四", "Thursday", "木曜日", "jeudi", "четверг"],
  ["星期五", "Friday", "金曜日", "vendredi", "пятница"],
  ["星期六", "Saturday", "土曜日", "samedi", "суббота"],
  ["星期日", "Sunday", "日曜日", "dimanche", "воскресенье"],
  ["星期天", "Sunday", "日曜日", "dimanche", "воскресенье"],
  // 日历星期表头（独立单字节点）
  ["一", "Mon", "月", "lun.", "пн"],
  ["二", "Tue", "火", "mar.", "вт"],
  ["三", "Wed", "水", "mer.", "ср"],
  ["四", "Thu", "木", "jeu.", "чт"],
  ["五", "Fri", "金", "ven.", "пт"],
  ["六", "Sat", "土", "sam.", "сб"],
  ["日", "Sun", "日", "dim.", "вс"],
  ["步", "steps", "ステップ", "étapes", "шагов"],
  // 首页日历标题「2026年11月」被拆成多个 span，单字成段时用连字符衔接（西文输出 2026-11）
  ["年", "-", "年", "-", "-"],
  ["月", "\u200b", "月", "\u200b", "\u200b"],

  // ---- D. 私信 / 会话 ----
  ["私信会话列表", "DM list", "DM一覧", "Liste des MP", "Список сообщений"],
  ["发起私聊", "New DM", "新規DM", "Nouveau MP", "Новый чат"],
  ["选择左侧会话，或发起新的私聊", "Select a conversation or start a new DM", "左の会話を選ぶか新規DMを開始", "Sélectionnez une conversation ou lancez un MP", "Выберите диалог или начните новый"],
  ["会话选项", "Chat options", "会話オプション", "Options", "Настройки чата"],
  ["的会话选项", "options", "の会話オプション", "— options", "— настройки"],
  ["与", "With", "と", "Avec", "С"],
  ["的会话", "conversation", "との会話", "— conversation", "— диалог"],
  ["发送", "Send", "送信", "Envoyer", "Отправить"],

  // ---- E. 首页营销文案 ----
  ["一个工作台，覆盖课程项目全流程", "One workspace for the whole course project", "一つのワークスペースで課題の全工程をカバー", "Un espace pour tout le projet de cours", "Одно пространство на весь проект"],
  ["三步，开始你的第一个敏捷项目", "Three steps to your first agile project", "3ステップで最初のアジャイルプロジェクトを開始", "Trois étapes vers votre premier projet agile", "Три шага до первого agile-проекта"],
  ["三步开始你的第一个敏捷项目", "Start your first agile project in three steps", "3ステップで最初のアジャイルプロジェクトを開始", "Démarrez votre premier projet agile en trois étapes", "Первый agile-проект за три шага"],
  ["开箱即用，无需额外配置", "Zero config, ready out of the box", "追加設定不要で利用可能", "Prêt à l'emploi, sans configuration", "Работает сразу, без настройки"],
  ["多人实时协作", "Real-time collaboration", "リアルタイム共同作業", "Collaboration en temps réel", "Совместная работа"],
  ["面向高校课程项目", "Built for course teams", "大学の課題チーム向け", "Pensé pour les équipes de cours", "Для учебных команд"],
  ["面向高校学生团队的敏捷协作平台 · 课程项目管理工具", "Agile collaboration for student teams · course project management", "学生チーム向けアジャイル協働プラットフォーム · 課題プロジェクト管理", "Plateforme agile pour équipes étudiantes · gestion de projets de cours", "Agile-платформа для студенческих команд · управление проектами"],
  ["高校团队敏捷项目管理平台", "Agile PM platform for campus teams", "大学チーム向けアジャイル管理プラットフォーム", "Plateforme agile pour équipes de campus", "Agile-платформа для кампусных команд"],
  ["AgileCampus 首页", "AgileCampus Home", "AgileCampus ホーム", "Accueil AgileCampus", "Главная AgileCampus"],
  ["Agile · 校园敏捷协作平台", "Agile · campus agile collaboration", "Agile · キャンパスアジャイル協働", "Agile · collaboration agile de campus", "Agile · кампусная платформа"],
  ["敏捷协作 · 课程项目", "Agile · course projects", "アジャイル協働 · 課題プロジェクト", "Agile · projets de cours", "Agile · учебные проекты"],
  ["敏捷校园", "Agile Campus", "アジャイルキャンパス", "Campus agile", "Agile Campus"],
  ["从这里开始探索", "Start exploring here", "ここから探索を始める", "Commencez à explorer ici", "Начните отсюда"],
  ["看看它能做什么", "See what it does", "機能を見る", "Voir les fonctions", "Что умеет"],
  ["登录并开始", "Log in & start", "ログインして開始", "Se connecter", "Войти и начать"],
  ["这是面向高校课程项目的敏捷协作平台。一个地方放看板、文档、讨论和进度，小组作业不用再在微信、网盘、表格之间来回切。", "An agile collaboration platform for university course projects. Boards, docs, discussion and progress in one place — no more juggling group chats, cloud drives and spreadsheets.", "大学の課題プロジェクト向けアジャイル協働プラットフォーム。看板・ドキュメント・議論・進捗を一箇所にまとめ、チャットやクラウドを行き来する必要はありません。", "Une plateforme agile pour les projets de cours universitaires. Tableaux, documents, discussions et avancement au même endroit — fini les allers-retours entre messageries, clouds et tableurs.", "Agile-платформа для университетских проектов. Доски, документы, обсуждения и прогресс в одном месте — без скачков между чатами, облаками и таблицами."],
  ["分工、进度、沟通与文档不再散落在五个工具里。每个环节都有明确的位置， 团队只需要关心一件事：把事情做完。", "Roles, progress, communication and docs no longer scattered across five tools. Every step has its place; the team focuses on one thing: getting it done.", "分担・進捗・コミュニケーション・ドキュメントが5つのツールに散らばらない。全部に明確な居場所があり、チームは「やり切る」ことに集中できます。", "Rôles, avancement, communication et docs ne s'éparpillent plus sur cinq outils. Chaque étape a sa place ; l'équipe se concentre sur l'essentiel : finir le travail.", "Роли, прогресс, общение и документы больше не разбросаны по пяти инструментам. У каждого шага своё место; команда занята одним — довести дело до конца."],
  ["从开学第一周到结课答辩，团队的节奏始终清晰。", "From week one to the final defense, the team's rhythm stays clear.", "開学初週から最終弁護まで、チームのリズムは常に明確。", "De la première semaine à la soutenance, le rythme de l'équipe reste clair.", "От первой недели до защиты — ритм команды под контролем."],
  ["把课程项目", "Take your course project — ", "課題プロジェクトを", "Votre projet de cours —", "Учебный проект —"],
  ["分工、看板、站会、文档与里程碑，收进同一个工作台。", "roles, boards, standups, docs and milestones, all in one workspace.", "分担・看板・朝会・ドキュメント・マイルストーンを一つのワークスペースへ。", "rôles, tableaux, points quotidiens, docs et jalons dans un seul espace.", "роли, доски, стендапы, документы и вехи — в одном пространстве."],
  ["待开始 / 进行中 / 已完成三列流转，截止日、优先级与检查清单同步更新。", "To-do / Doing / Done columns flow, with due dates, priorities and checklists in sync.", "未着手・進行中・完了の3列で流れ、締め切り・優先度・チェックリストも同期。", "Colonnes À faire / En cours / Terminé, avec dates, priorités et checklists synchronisées.", "Колонки «К выполнению / В работе / Готово» с синхронными сроками и чек-листами."],
  ["课程文档在线协作，版本留痕、评论可追溯，随时回到任意一稿。", "Collaborate on course docs online — version history, traceable comments, return to any draft anytime.", "課題ドキュメントをオンライン共同編集。版の履歴とコメントを追跡でき、いつでも任意の稿に戻れます。", "Coéditez les documents en ligne — historique de versions, commentaires traçables, retour à tout brouillon.", "Совместное редактирование документов — история версий, комментарии, возврат к любому черновику."],
  ["把答辩节点、交付物与参考资料挂到同一条时间线上，关键日期不再漏项。", "Put defense dates, deliverables and references on one timeline — no key date slips through.", "弁護日・成果物・参考資料を同じタイムラインに。重要な日付を見落としません。", "Dates de soutenance, livrables et références sur une même timeline — aucune échéance n'échappe.", "Защиты, результаты и материалы — на одной таймлайнии; ни одна дата не потеряется."],
  ["在项目频道完成站会，进展与阻塞自动汇总成当日摘要，不必再逐条追问。", "Run standups in the project channel; progress and blockers roll up into a daily digest automatically.", "プロジェクトチャンネルで朝会。進捗とブロッカーは自動で当日の要約にまとまります。", "Tenez vos points quotidiens dans le canal projet ; avancement et blocages alimentent un résumé automatique.", "Стендапы в канале проекта; прогресс и блокеры сами попадают в дневную сводку."],
  ["每日站会", "Daily standup", "デイリースタンドアップ", "Point quotidien", "Дейли"],
  ["里程碑", "Milestones", "マイルストーン", "Jalons", "Вехи"],
  ["文档协作", "Doc collaboration", "ドキュメント共同編集", "Coédition de docs", "Совместные документы"],
  ["协作沟通", "Communication", "協働コミュニケーション", "Communication", "Общение"],
  ["进入每日站会", "Open daily standup", "朝会へ", "Ouvrir le point quotidien", "Открыть дейли"],
  ["进入里程碑", "Open milestones", "マイルストーンへ", "Ouvrir les jalons", "Открыть вехи"],
  ["进入文档协作", "Open doc collaboration", "ドキュメント共同編集へ", "Ouvrir la coédition", "Открыть документы"],
  ["进入项目", "Open project", "プロジェクトへ", "Ouvrir le projet", "Открыть проект"],
  ["接口文档", "Docs", "ドキュメント", "Docs", "Документы"],

  // ---- F. 设置 / 外观 / 密码 ----
  ["个人简介", "Bio", "自己紹介", "Bio", "О себе"],
  ["学工号", "Student ID", "学籍番号", "Numéro étudiant", "Номер студента"],
  ["性别", "Gender", "性別", "Genre", "Пол"],
  ["男", "Male", "男性", "Homme", "Мужской"],
  ["女", "Female", "女性", "Femme", "Женский"],
  ["地区", "Region", "地域", "Région", "Регион"],
  ["登录邮箱：", "Sign-in email: ", "ログインメール：", "E-mail de connexion : ", "Почта входа: "],
  ["（邮箱不可修改）；以下资料仅本人可更改", "(email cannot be changed); only you can edit the fields below", "（メールは変更不可）;以下は本人のみ変更できます", "(e-mail non modifiable) ; seul vous pouvez modifier ces champs", "(почту изменить нельзя); эти поля редактируете только вы"],
  ["展示名称，可不填（默认显示学工号）", "Display name, optional (defaults to student ID)", "表示名（任意・未入力は学籍番号）", "Nom affiché, optionnel (numéro étudiant par défaut)", "Отображаемое имя (по умолчанию — номер студента)"],
  ["例如：2023210315", "e.g. 2023210315", "例：2023210315", "ex. 2023210315", "напр. 2023210315"],
  ["例如：福建 福州", "e.g. Fujian, Fuzhou", "例：福建 福州", "ex. Fujian, Fuzhou", "напр. Фуцзянь, Фучжоу"],
  ["介绍一下自己，让队友更了解你（研究方向、擅长技能、担当角色等）", "Introduce yourself so teammates know you better (research area, skills, role…)", "自己紹介を書いて仲間に伝えましょう（研究方向・得意技能・担当役割など）", "Présentez-vous pour que l'équipe vous connaisse (axe de recherche, compétences, rôle…)", "Расскажите о себе (направление, навыки, роль в команде…)"],
  ["修改密码", "Change password", "パスワード変更", "Changer le mot de passe", "Смена пароля"],
  ["当前密码", "Current password", "現在のパスワード", "Mot de passe actuel", "Текущий пароль"],
  ["新密码", "New password", "新しいパスワード", "Nouveau mot de passe", "Новый пароль"],
  ["新密码（至少 6 位）", "New password (min 6 chars)", "新しいパスワード（6文字以上）", "Nouveau mot de passe (6 car. min)", "Новый пароль (мин. 6 знаков)"],
  ["确认新密码", "Confirm new password", "新しいパスワード（確認）", "Confirmer le mot de passe", "Подтвердите пароль"],
  ["修改成功后，其他已登录的设备会自动退出，需要用新密码重新登录。", "After changing, other signed-in devices will be logged out; sign in again with the new password.", "変更後は他のログイン端末が自動ログアウトされ、新パスワードで再ログインが必要です。", "Après modification, les autres appareils seront déconnectés ; reconnectez-vous avec le nouveau mot de passe.", "После смены другие устройства выйдут из системы; войдите с новым паролем."],
  ["外观自定义", "Appearance", "外観カスタマイズ", "Apparence", "Оформление"],
  ["选择一个全站背景氛围色，或填入图片链接。设置立即生效、随时清除，仅保存在你自己的浏览器里。", "Pick a site-wide background tint or paste an image URL. Applies instantly, clears anytime, stored only in your browser.", "サイト全体の背景色を選ぶか画像URLを入力。即時反映・いつでも解除でき、自分のブラウザにのみ保存されます。", "Choisissez une teinte de fond ou collez une URL d'image. Effet immédiat, réversible, stocké uniquement dans votre navigateur.", "Выберите фоновый оттенок или вставьте ссылку на картинку. Мгновенно, обратимо, хранится только у вас."],
  ["背景：", "Background: ", "背景：", "Fond : ", "Фон: "],
  ["自定义背景图片链接", "Custom background image URL", "カスタム背景画像URL", "URL d'image de fond", "Ссылка на фон"],
  ["图片链接（https://…），留空则不使用图片背景", "Image URL (https://…); leave empty for no image background", "画像URL（https://…）・空欄なら画像背景なし", "URL d'image (https://…) ; vide = pas d'image", "Ссылка (https://…); пусто — без картинки"],
  ["应用图片", "Apply image", "画像を適用", "Appliquer l'image", "Применить"],
  ["恢复「新手导引」入口", "Restore the quick-guide launcher", "「はじめに」入口を復元", "Restaurer le lanceur du guide", "Вернуть кнопку гида"],
  ["恢复被右键屏蔽的新手导引悬浮入口", "Restore the quick-guide floating launcher hidden via right-click", "右クリックで非表示にした「はじめに」浮遊入口を復元", "Restaurer le lanceur flottant masqué par clic droit", "Вернуть скрытый правым кликом значок гида"],
  ["星夜蓝紫", "Starry indigo", "星夜の藍紫", "Indigo étoilé", "Звёздный индиго"],
  ["晨雾青绿", "Misty teal", "朝霧の青緑", "Sarcelle brumeuse", "Туманный бирюзовый"],
  ["暖阳米橘", "Warm amber", "暖陽のオレンジ", "Ambre chaud", "Тёплый янтарный"],
  ["樱粉", "Sakura pink", "桜ピンク", "Rose sakura", "Розовая сакура"],
  ["深海导航蓝", "Deep-sea blue", "深海のブルー", "Bleu abyssal", "Глубокий синий"],
  ["石墨黑", "Graphite black", "グラファイトブラック", "Graphite", "Графитовый"],
  ["未设置", "Not set", "未設定", "Non défini", "Не задано"],
  ["保密", "Private", "非公開", "Privé", "Скрыто"],

  // ---- G. 导引页 ----
  ["新手导引：8 步快速上手平台", "Quick guide: 8 steps to master the platform", "はじめに：8ステップで使い方を習得", "Guide rapide : 8 étapes", "Гид: 8 шагов до платформы"],
  ["三分钟认识 AgileCampus", "Meet AgileCampus in 3 minutes", "3分でAgileCampusを知る", "AgileCampus en 3 minutes", "AgileCampus за 3 минуты"],
  ["认识平台", "Know the platform", "プラットフォームを知る", "Découvrir la plateforme", "Знакомство"],
  ["上手路线", "Getting started", "はじめ方", "Premiers pas", "С чего начать"],
  ["效率技巧", "Tips", "効率のコツ", "Astuces", "Советы"],
  ["怎么做", "How it works", "使い方", "Comment faire", "Как это"],
  ["全局认知", "The big picture", "全体像", "Vue d'ensemble", "Общая картина"],
  ["第", "Step", "第", "Étape", "Шаг"],
  ["导引步骤", "Guide steps", "ガイドのステップ", "Étapes du guide", "Шаги гида"],
  ["顶部导航和工作台左侧图标栏是两条主线", "Top navigation and the workspace icon rail are the two main threads", "上部ナビとワークスペース左のアイコン欄が2本の主線", "La nav haute et le rail d'icônes sont les deux fils directeurs", "Верхняя навигация и левый ряд иконок — две опоры"],
  ["先记住两个地址：/ 是门面，/workspace 是主场。之后所有操作都在工作台里完成。", "Remember two addresses: / is the storefront, /workspace is where work happens.", "2つのURLを覚えてください：/ は表玄関、/workspace は主戦場。以後の操作はすべてワークスペースで。", "Retenez deux adresses : / est la vitrine, /workspace est l'atelier.", "Запомните два адреса: / — витрина, /workspace — мастерская."],
  ["首页（/）展示平台能做什么和三步开始入口", "The home page (/) shows what the platform does and how to start", "ホーム（/）は機能と3ステップ開始の入口", "L'accueil (/) présente la plateforme et le démarrage", "Главная (/) — о платформе и старте"],
  ["工作台（/workspace）是每天真正干活的地方", "The workspace (/workspace) is where daily work happens", "ワークスペース（/workspace）が日々の作業場所", "L'espace (/workspace) est le lieu de travail quotidien", "Пространство (/workspace) — место ежедневной работы"],
  ["界面示意", "Preview", "画面イメージ", "Aperçu", "Превью"],
  ["认识平台界面示意", "Platform preview", "プラットフォームの画面イメージ", "Aperçu de la plateforme", "Обзор интерфейса"],
  ["示意 · 第", "Fig. ", "図 · 第", "Fig. ", "Рис. "],
  ["打开新手导引", "Open quick guide", "はじめにを開く", "Ouvrir le guide", "Открыть гид"],
  ["1 / 8 步", "1 / 8", "1 / 8", "1 / 8", "1 / 8"],

  // ---- H. 插件商城 ----
  ["已启用", "Enabled", "有効", "Activé", "Включён"],
  ["未启用", "Off", "無効", "Désactivé", "Выключен"],
  ["启用", "Enable", "有効化", "Activer", "Включить"],
  ["停用", "Disable", "無効化", "Désactiver", "Выключить"],
  ["标准格式", "Standard format", "標準フォーマット", "Format standard", "Стандартный формат"],
  ["多语言", "Multilingual", "多言語", "Multilingue", "Мультиязычность"],
  ["效率", "Productivity", "効率", "Productivité", "Продуктивность"],
  ["主题", "Theme", "テーマ", "Thème", "Тема"],
  ["集成", "Integration", "連携", "Intégration", "Интеграции"],
  ["插件为平台增添功能，可随时启用或停用；全部遵循统一的标准格式。", "Plugins add features and can be toggled anytime; all follow one standard format.", "プラグインは機能を追加し、いつでも有効/無効を切替可能。すべて統一フォーマットに従います。", "Les extensions ajoutent des fonctions, activables à tout moment, toutes au même format.", "Плагины добавляют функции, включаются в любой момент; единый формат."],
  ["插件标准格式（含最小示例）见仓库", "Plugin spec (with a minimal example) lives in the repo", "プラグイン標準フォーマット（最小例つき）はリポジトリ参照", "Le format des extensions (avec exemple) est dans le dépôt", "Формат плагинов (с примером) — в репозитории"],
  ["Switch 工作助手", "Switch Assistant", "Switch アシスタント", "Assistant Switch", "Switch-ассистент"],
  ["可接入任意 LLM 供应商的 AI 工作辅助 agent：文档阅读/整理/总结、多语言翻译；像 CC Switch 一样管理多个 API Key 并一键切换。", "An AI work assistant that plugs into any LLM provider: doc reading, summarizing, multilingual translation; manage multiple API keys and switch instantly, like CC Switch.", "任意の LLM プロバイダに接続できる AI 作業アシスタント。ドキュメント読取・要約・多言語翻訳に対応し、CC Switch のように複数の API Key を切替管理できます。", "Un assistant IA connectable à tout fournisseur LLM : lecture et synthèse de docs, traduction multilingue ; gérez plusieurs clés API et basculez en un clic, comme CC Switch.", "ИИ-ассистент для любого LLM-провайдера: чтение и краткое изложение документов, перевод; управление ключами API и мгновенное переключение — как CC Switch."],
  ["；独立副本见", "; standalone copy on the ", "；独立コピーは", "; copie autonome sur la ", "; отдельная копия — ветка "],
  ["分支。", " branch.", "ブランチ参照。", " branche.", " плагина."],
  ["把界面文案切换为英语 / 日语 / 法语 / 俄语；覆盖导航、任务、文档、设置等常用界面，未收录内容保持原文，随时可切回中文。", "Switch the UI to English / Japanese / French / Russian; covers navigation, tasks, docs and settings, untranslated content stays as-is, switch back anytime.", "UIを英語・日本語・フランス語・ロシア語へ切替。ナビ・タスク・ドキュメント・設定など主要画面に対応し、いつでも中国語へ戻せます。", "Passez l'interface en anglais / japonais / français / russe ; couvre navigation, tâches, docs et réglages ; retour au chinois à tout moment.", "Переключает интерфейс на английский / японский / французский / русский; охватывает навигацию, задачи, документы и настройки; возврат в любой момент."],
  ["邮箱", "Email", "メールアドレス", "E-mail", "Почта"],
  ["密码", "Password", "パスワード", "Mot de passe", "Пароль"],
  ["登录工作台", "Sign in", "ログイン", "Connexion", "Вход"],

  // ---- I. 分段 tokens：标点 / 量词复合 / 星期 / 杂项 ----
  ["，", ", ", "，", ", ", ", "],
  ["。", ". ", "。", ". ", ". "],
  ["：", ": ", "：", " : ", ": "],
  ["；", "; ", "；", "; ", "; "],
  ["（", " (", "（", " (", " ("],
  ["）", ")", "）", ")", ")"],
  ["「", "“", "「", "« ", "«"],
  ["」", "”", "」", " »", "»"],
  ["、", ", ", "、", ", ", ", "],
  ["搜索…", "Search…", "検索…", "Rechercher…", "Поиск…"],
  ["的任务", "'s tasks", "のタスク", "— tâches", "— задачи"],
  ["项", "items", "項目", "éléments", "пунктов"],
  ["做出", "delivered", "完了", "livrés", "сдано"],
];

/** 日期模板的动态规则（仅西文语种；日语保留年月日写法） */
type Rule = readonly [RegExp, string];
const LATIN_DATE_RULES: readonly Rule[] = [
  [/(\d{4})年(\d{1,2})月(\d{1,2})日(?=星期)/g, "$1-$2-$3 "],
  [/(\d{4})年(\d{1,2})月(\d{1,2})日/g, "$1-$2-$3"],
  [/(\d{4})年(\d{1,2})月/g, "$1-$2"],
  [/(\d{1,2})月(\d{1,2})日(?=星期)/g, "$1/$2 "],
  [/(\d{1,2})月(\d{1,2})日/g, "$1/$2"],
  [/\s将(?=\s)/g, " "],
  // 计数句式「有 1 个…」去掉「有」；前面是汉字（如「还有」）时不适用
  [/(?<![\u4e00-\u9fff])\s?有(?=\s?\d)/g, " "],
];
const RULES: Record<Locale, readonly Rule[]> = {
  en: LATIN_DATE_RULES,
  fr: LATIN_DATE_RULES,
  ru: LATIN_DATE_RULES,
  ja: [
    [/(\d+)\s*个/g, "$1個"],
    // 「23日星期一」中日与星期连成一段，插入空格断词，交由分段层译「星期一→月曜日」
    [/日(?=星期)/g, "日 "],
  ],
};

/** 量词吞并：N 个/条/位/项/篇/步 → N。后随正文时补一个空格，行尾/分隔符前不补 */
const COUNTER_RE = /(\d+)\s*[个条位项篇步](?![邀请a-z])/g;

/** 汉字连续段；全角标点作为独立边界，避免「早上好，陈后端」粘成一段 */
const IDEO_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;
/** 全角标点（单独成段，逐个替换） */
const FW_PUNCT = /[\uff00-\uffef\u3000-\u303f\u2014\u2018\u2019\u201c\u201d\u2026]/g;

function build(index: 1 | 2 | 3 | 4): Record<string, string> {
  const dict: Record<string, string> = {};
  for (const row of ROWS) dict[row[0]] = row[index];
  return dict;
}

export const DICTIONARIES: Record<Locale, Record<string, string>> = {
  en: build(1),
  ja: build(2),
  fr: build(3),
  ru: build(4),
};

/** 非空字符串是否为受支持的目标语言代码 */
export function isLocale(value: string): value is Locale {
  return value === "en" || value === "ja" || value === "fr" || value === "ru";
}

/** 行表唯一性（防止手写重复键悄悄覆盖） */
export function rowKeysUnique(): boolean {
  const seen = new Set<string>();
  for (const row of ROWS) {
    if (seen.has(row[0])) return false;
    seen.add(row[0]);
  }
  return true;
}

/**
 * 翻译一段界面文本：整句精确 → 动态模板规则 → CJK 分段逐段查词典。
 * 未命中任何一层时原样返回（用户数据、未收录内容不受影响）。
 */
export function translateText(raw: string, locale: Locale): string {
  const dict = DICTIONARIES[locale];
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 120) return raw;
  // 含汉字或全角标点才进入翻译（纯数字/拉丁/用户数据直接跳过）
  if (!/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(trimmed)) return raw;

  // 1) 整句精确匹配（保留首尾空白）
  const exact = dict[trimmed];
  if (exact !== undefined) return raw.replace(trimmed, exact);

  // 2) 日期 / 量词模板规则
  let text = raw;
  let ruleHit = false;
  for (const [pattern, replacement] of RULES[locale]) {
    if (pattern.test(text)) { ruleHit = true; pattern.lastIndex = 0; text = text.replace(pattern, replacement); }
    else pattern.lastIndex = 0;
  }
  if (locale !== "ja") {
    const next = text;
    if (COUNTER_RE.test(next)) {
      ruleHit = true;
      text = next.replace(COUNTER_RE, (match, digits, offset, whole) => {
        const after = whole[offset + match.length] ?? "";
        return /[\s·,.;、，。；）」]/.test(after) || after === "" ? digits : digits + " ";
      });
    }
    COUNTER_RE.lastIndex = 0;
  }

  // 3) 分段翻译：汉字段整段查词典；全角标点逐个替换
  let segHit = false;
  text = text.replace(IDEO_RUN, (segment) => {
    const hit = dict[segment];
    if (hit === undefined) return segment;
    segHit = true;
    return hit;
  });
  text = text.replace(FW_PUNCT, (ch) => {
    const hit = dict[ch];
    if (hit === undefined) return ch;
    segHit = true;
    return hit;
  });

  return ruleHit || segHit ? text : raw;
}
