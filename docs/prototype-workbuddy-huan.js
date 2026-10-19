/* 独立交互原型：所有数据留在当前浏览器页面，不调用后端或 AI。 */
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const icon = (name, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  const templates = [
    {id:'weekly', category:'运营增长', icon:'chart', tone:'orange', title:'生成投放周报', description:'整理渠道数据，输出复盘和下周建议', prompt:'请根据本周渠道投放数据，生成一份可交付的运营周报，包含核心指标、异常分析和下周建议。'},
    {id:'creative', category:'设计创意', icon:'image', tone:'yellow', title:'产出营销创意', description:'从业务目标到文案和视觉方向', prompt:'请为欢网科技的智能大屏营销活动，构思 3 套创意主题、主视觉方向和渠道文案。'},
    {id:'research', category:'数据分析', icon:'search', tone:'blue', title:'行业调研分析', description:'汇总信息源，形成结构化报告', prompt:'请调研智能大屏广告行业趋势，整理市场动态、典型案例与欢网科技可借鉴的机会点。'},
    {id:'check', category:'运营增长', icon:'shield', tone:'green', title:'检查素材合规', description:'让 AI 成员检查规范并列出风险项', prompt:'请调用素材合规风险扫描技能，检查这批 OTT 投放素材并汇总需人工复核的问题。'},
    {id:'ppt', category:'设计创意', icon:'file', tone:'orange', title:'制作汇报材料', description:'把项目资料转成汇报大纲', prompt:'请将当前项目的进展整理成一份月度汇报大纲，列出每页标题和关键结论。'},
    {id:'data', category:'数据分析', icon:'database', tone:'yellow', title:'分析渠道 ROI', description:'比较渠道投入、转化与回报', prompt:'请对渠道 ROI 数据进行对比分析，找出表现最好的渠道与预算优化建议。'},
  ];

  const tasks = [
    {id:'task-1', title:'生成 9 月渠道投放复盘周报', status:'done', statusText:'已完成', time:'今天 10:42', owner:'AI·数据分析师', prompt:'结合 9 月渠道 ROI 数据，生成一份投放复盘周报，标出异常渠道，并给出下月预算建议。', demo:true,
      steps:[['读取「渠道 ROI 数据」和投放运营规范','已完成'],['分析渠道表现与异常波动','已完成'],['生成复盘周报和预算建议','已完成']],
      files:[{name:'9月渠道投放复盘.md',type:'文档',icon:'file',size:'24 KB'},{name:'渠道 ROI 趋势.csv',type:'数据表',icon:'chart',size:'18 KB'}]},
    {id:'task-2', title:'检查 OTT 素材合规风险', status:'review', statusText:'待审核', time:'今天 09:18', owner:'AI·质量巡检', prompt:'扫描本周 OTT 素材包，按照投放运营规范列出合规风险，供运营同事审核。', demo:true,
      steps:[['读取授权素材与投放规范','已完成'],['调用素材合规风险扫描技能','已完成'],['等待人工复核 2 条风险项','待审核']],
      files:[{name:'素材风险检查清单.md',type:'文档',icon:'file',size:'12 KB'}]},
    {id:'task-3', title:'整理平台产品需求评审记录', status:'running', statusText:'进行中', time:'昨天 16:35', owner:'AI·投放文案', prompt:'整理平台产品需求评审记录，汇总待办、负责人和截止时间。', demo:true,
      steps:[['读取会议纪要与平台产品文档','已完成'],['提取待办与负责人','进行中'],['输出结构化清单','待执行']],
      files:[]},
  ];

  const projects = [
    {name:'智能大屏增长计划',description:'渠道投放、效果分析和素材协同',progress:72,items:'12 项任务 · 3 位 AI 成员',icon:'chart',tone:'orange'},
    {name:'OTT 素材合规专项',description:'素材检查、风险复核与规范更新',progress:54,items:'8 项任务 · 2 位 AI 成员',icon:'shield',tone:'yellow'},
    {name:'欢网 AI 平台建设',description:'产品研发、知识沉淀和交付验收',progress:86,items:'16 项任务 · 4 位成员',icon:'box',tone:'blue'},
  ];
  const extensions = {
    agents: [
      {name:'增长分析 Agent',description:'自动拆解投放数据，调用报表技能并输出增长建议',meta:'Claude Sonnet 4.5 · 2 项技能',icon:'chart',tone:'orange',model:'Claude Sonnet 4.5',expert:'AI·数据分析师',skills:'渠道 ROI 报表生成、周报摘要助手',connector:'数据报表服务',prompt:'请调用增长分析 Agent，分析本周渠道投放表现并给出预算建议。',enabled:true},
      {name:'素材巡检 Agent',description:'按团队规范检查 OTT 素材，标记待人工复核的风险',meta:'Claude Sonnet 4.5 · 1 项技能',icon:'shield',tone:'green',model:'Claude Sonnet 4.5',expert:'AI·质量巡检',skills:'素材合规风险扫描',connector:'团队知识库',prompt:'请调用素材巡检 Agent，检查本次 OTT 投放素材。',enabled:true},
      {name:'创意协作 Agent',description:'联动文案专家与知识库，生成多渠道创意草案',meta:'Claude Opus 4.5 · 1 项技能',icon:'spark',tone:'yellow',model:'Claude Opus 4.5',expert:'AI·投放文案',skills:'素材文案生成',connector:'团队知识库',prompt:'请调用创意协作 Agent，为智能大屏营销活动生成创意方案。',enabled:true},
    ],
    experts: [
      {name:'AI·数据分析师',description:'擅长渠道数据、ROI 分析和报表生成',meta:'已加入平台产品组',icon:'chart',tone:'orange',prompt:'@AI·数据分析师 请帮我分析本周渠道 ROI 数据，输出关键发现。'},
      {name:'AI·投放文案',description:'活动创意、营销文案和素材优化',meta:'已加入平台产品组',icon:'spark',tone:'yellow',prompt:'@AI·投放文案 请为智能大屏活动写 3 版投放文案。'},
      {name:'AI·质量巡检',description:'规则检查、素材合规和风险标注',meta:'已加入平台产品组',icon:'shield',tone:'green',prompt:'@AI·质量巡检 请检查 OTT 素材的合规风险。'},
    ],
    skills: [
      {name:'素材文案生成',description:'根据活动目标生成渠道文案与改写建议',meta:'v1.2.0 · 团队技能',icon:'spark',tone:'orange',prompt:'请使用素材文案生成技能，输出新品活动的渠道文案。'},
      {name:'渠道 ROI 报表生成',description:'汇总投放指标并生成对比报表',meta:'v2.0.1 · 团队技能',icon:'chart',tone:'blue',prompt:'请使用渠道 ROI 报表生成技能，整理本月渠道表现。'},
      {name:'素材合规风险扫描',description:'对照投放规范标记风险内容',meta:'v1.0.3 · 团队技能',icon:'shield',tone:'green',prompt:'请使用素材合规风险扫描技能，检查本次投放素材。'},
    ],
    connectors: [
      {name:'企业微信',description:'接收任务通知与远程发送指令',meta:'已连接 · 欢网企业空间',icon:'message',tone:'green',connected:true},
      {name:'团队知识库',description:'检索平台文档和运营规范',meta:'已连接 · 3 个知识空间',icon:'book',tone:'orange',connected:true},
      {name:'数据报表服务',description:'获取授权范围内的渠道报表',meta:'待连接 · 需空间管理员授权',icon:'database',tone:'blue',connected:false},
    ],
  };
  const extensionLabels = {agents:'Agent',experts:'专家',skills:'技能',connectors:'连接器'};
  const extensionStorageKey = 'huanbuddy-prototype-capabilities-v1';
  Object.entries(extensions).forEach(([kind,items]) => items.forEach((item,index) => { item.id = `${kind}-${index+1}`; }));
  try {
    const saved = JSON.parse(localStorage.getItem(extensionStorageKey) || 'null');
    if (saved && typeof saved === 'object') {
      Object.keys(extensionLabels).forEach(kind => {
        if (Array.isArray(saved[kind])) {
          const valid = saved[kind].filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.description === 'string');
          extensions[kind].splice(0, extensions[kind].length, ...valid);
        }
      });
    }
  } catch { /* 本地存储不可用时仍可在当前页面编辑。 */ }

  function saveExtensions() {
    try { localStorage.setItem(extensionStorageKey, JSON.stringify(extensions)); return true; }
    catch { return false; }
  }
  const library = [
    {name:'投放运营规范',type:'团队空间',icon:'book',tone:'orange',meta:'6 篇文档 · 今天更新',description:'素材规范、渠道投放与复核流程'},
    {name:'增长方法论',type:'团队空间',icon:'chart',tone:'yellow',meta:'4 篇文档 · 昨天更新',description:'转化分析、增长实验与复盘模板'},
    {name:'平台产品文档',type:'团队空间',icon:'folder',tone:'blue',meta:'8 篇文档 · 10 月 15 日更新',description:'PRD、架构和交付手册'},
    {name:'9 月渠道投放复盘.md',type:'我的文档',icon:'file',tone:'green',meta:'24 KB · 今天生成',description:'由 AI·数据分析师生成的示例产物'},
  ];
  const schedules = [
    {id:'s1',title:'每周一渠道投放简报',when:'每周一 09:00',agent:'AI·数据分析师',enabled:true},
    {id:'s2',title:'每日素材风险巡检',when:'每天 18:00',agent:'AI·质量巡检',enabled:true},
    {id:'s3',title:'月度知识库更新摘要',when:'每月 1 日 10:00',agent:'AI·投放文案',enabled:false},
  ];

  const state = {page:'home',activeTask:'task-1',category:'全部',extensionTab:'agents',libraryTab:'all',resultTab:'artifacts',resultOpen:true,draft:'',attachments:[],mode:'Agent',model:'Claude Sonnet 4.5',workspace:'欢网 · 平台产品组',filter:'',editingCapability:null};

  function toast(message) {
    const region = $('#toastRegion');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    region.appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }

  function setPage(page, taskId) {
    const previousPage = state.page;
    const previousTask = state.activeTask;
    state.page = page;
    if (taskId) state.activeTask = taskId;
    if (page === 'task' && (previousPage !== 'task' || previousTask !== state.activeTask)) {
      state.resultTab = 'artifacts';
      state.resultOpen = !matchMedia('(max-width: 640px)').matches;
    }
    state.filter = '';
    $('#profileMenu').hidden = true;
    $('#profileButton').setAttribute('aria-expanded','false');
    closeSidebar();
    const hash = page === 'task' ? `#task/${state.activeTask}` : `#${page}`;
    if (location.hash !== hash) history.replaceState(null,'',hash);
    render();
  }

  function render() {
    const titles = {home:'工作台',task:'任务对话',assistant:'助理',projects:'项目',board:'任务看板',members:'AI 成员',extensions:'Agent · 专家 · 技能 · 连接器',schedule:'定时任务',library:'资料库',governance:'模型与安全'};
    $('#breadcrumbCurrent').textContent = titles[state.page] || '工作台';
    $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === state.page));
    renderRecentTasks();
    const views = {home:homeView,task:taskView,assistant:assistantView,projects:projectsView,board:boardView,members:membersView,extensions:extensionsView,schedule:scheduleView,library:libraryView,governance:governanceView};
    $('#mainContent').innerHTML = (views[state.page] || homeView)();
    $('#mainContent').scrollTop = 0;
  }

  function renderRecentTasks() {
    $('#recentTaskNav').innerHTML = tasks.slice(0,4).map(task => `<button class="recent-task-link ${state.page === 'task' && state.activeTask === task.id ? 'active':''}" data-task="${esc(task.id)}"><span class="status-dot ${esc(task.status)}"></span><span>${esc(task.title)}</span></button>`).join('');
  }

  function header(kicker, title, subtitle, action = '') {
    return `<div class="page-heading"><div><div class="page-kicker">${icon('spark')}${kicker}</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
  }

  function composer(isThread = false) {
    const placeholder = isThread ? '继续输入任务要求，或对结果提出修改意见…' : '告诉欢网 Buddy 你想完成什么工作，例如：整理渠道数据并生成复盘报告…';
    return `<div class="composer-card" data-composer>
      ${isThread ? '' : `<div class="composer-head"><button class="composer-tab ${['全部','运营增长'].includes(state.category)?'active':''}" type="button" data-template-category="全部">${icon('spark')} 智能任务</button><button class="composer-tab ${state.category==='设计创意'?'active':''}" type="button" data-template-category="设计创意">${icon('image')} 设计创意</button><button class="composer-tab ${state.category==='数据分析'?'active':''}" type="button" data-template-category="数据分析">${icon('chart')} 数据分析</button></div>`}
      <div class="composer-inner"><textarea id="taskInput" class="task-textarea" aria-label="输入任务要求" placeholder="${placeholder}">${esc(state.draft)}</textarea>
      <div class="attachment-list" id="attachmentList">${state.attachments.map((name,i) => `<span class="attachment-chip">${icon('file')}<span title="${esc(name)}">${esc(name)}</span><button type="button" data-remove-attachment="${i}" aria-label="移除 ${esc(name)}">${icon('close')}</button></span>`).join('')}</div>
      <div class="composer-toolbar"><input id="attachmentInput" type="file" multiple hidden><button class="composer-tool" type="button" data-action="attach" title="添加附件">${icon('clip')}<span>添加文件</span></button>
      <button class="composer-tool" type="button" data-action="workspace" title="选择工作空间">${icon('folder')}<span>${esc(state.workspace)}</span>${icon('down')}</button>
      <button class="composer-tool mode-tag" type="button" data-action="mode" title="切换工作模式">${icon('zap')}<span>${esc(state.mode)}</span>${icon('down')}</button>
      <button class="composer-tool" type="button" data-action="model" title="切换模型">${icon('spark')}<span>${esc(state.model)}</span>${icon('down')}</button>
      <span class="toolbar-spacer"></span><button class="send-button" type="button" data-action="send" title="发送任务" aria-label="发送任务">${icon('send')}</button></div></div></div>
      ${isThread ? '' : `<div class="composer-hint">支持自然语言、文件附件、工作模式和模型选择 · 原型不执行真实任务</div>`}`;
  }

  function homeView() {
    const cards = (state.category === '全部' ? templates.slice(0,4) : templates.filter(item => item.category === state.category)).map(item => `<button class="template-card" data-template="${item.id}"><span class="template-icon ${item.tone === 'orange'?'':item.tone}">${icon(item.icon)}</span><strong>${esc(item.title)}</strong><small>${esc(item.description)}</small>${icon('arrow','card-arrow')}</button>`).join('');
    return `<div class="home-page"><section class="home-hero"><div class="hero-copy"><div class="hero-eyebrow">${icon('spark')} 欢迎回来，张伟</div><h1>把想法交给 AI，<br><em>把成果带回工作。</em></h1><p>从一句话开始，让专家、技能和资料库为你的任务协同工作。</p></div><div class="hero-orb" aria-hidden="true"><span></span></div></section>
      ${composer()}
      <section class="home-section"><div class="section-title-line"><div><h2>从一个想法开始</h2><p>选择场景，快速填入任务描述</p></div><button class="text-link" data-page="extensions">探索全部能力 ${icon('arrow')}</button></div>
      <div class="category-tabs">${['全部','运营增长','数据分析','设计创意'].map(category => `<button class="category-tab ${state.category===category?'active':''}" data-category="${category}">${category}</button>`).join('')}</div><div class="template-grid">${cards}</div></section>
      <div class="home-lower"><section><div class="section-title-line"><div><h2>最近任务</h2><p>多个任务可以并行推进</p></div><button class="text-link" data-page="board">查看任务看板 ${icon('arrow')}</button></div><div class="task-list-card">${tasks.slice(0,3).map(task => `<button class="home-task-row" data-task="${esc(task.id)}"><span class="task-row-icon">${icon(task.status==='done'?'check':task.status==='review'?'shield':'zap')}</span><span class="task-row-copy"><strong>${esc(task.title)}</strong><small>${esc(task.owner)} · ${esc(task.time)}</small></span><span class="status-pill ${esc(task.status)}"><span class="status-dot ${esc(task.status)}"></span>${esc(task.statusText)}</span>${icon('right')}</button>`).join('')}</div></section>
      <section><div class="section-title-line"><div><h2>最近产物</h2><p>任务结果集中查看和复用</p></div><button class="text-link" data-task="task-1">查看全部 ${icon('arrow')}</button></div><div class="artifact-list-card"><button class="artifact-row" data-task="task-1"><span class="artifact-icon">${icon('file')}</span><span class="artifact-copy"><strong>9 月渠道投放复盘.md</strong><small>文档 · 今天 10:42</small></span>${icon('right')}</button><button class="artifact-row" data-task="task-1"><span class="artifact-icon blue">${icon('chart')}</span><span class="artifact-copy"><strong>渠道 ROI 趋势.csv</strong><small>数据表 · 今天 10:42</small></span>${icon('right')}</button><button class="artifact-row" data-task="task-2"><span class="artifact-icon green">${icon('shield')}</span><span class="artifact-copy"><strong>素材风险检查清单.md</strong><small>文档 · 今天 09:18</small></span>${icon('right')}</button></div></section></div>
    </div>`;
  }

  function taskView() {
    const task = tasks.find(item => item.id === state.activeTask) || tasks[0];
    const steps = task.steps?.length ? `<div class="execution-card"><div class="execution-card-head">${icon('zap')} 执行过程 <span style="margin-left:auto;font-weight:500">${task.steps.length} 个步骤</span></div><div class="execution-steps">${task.steps.map(([label,status])=>`<div class="execution-step ${status==='已完成'?'':'pending'}">${icon(status==='已完成'?'check':'clock')}<span>${esc(label)}</span><small>${esc(status)}</small></div>`).join('')}</div></div>` : '';
    const resultChips = task.files.length ? `<div class="result-chip-row">${task.files.map((file,index)=>`<button class="result-chip" data-file="${index}">${icon(file.icon)}${esc(file.name)}${icon('right')}</button>`).join('')}</div>` : '';
    let assistantMessage;
    if (task.demo) {
      assistantMessage = `<p>已根据授权资料整理任务。${task.status==='done'?'复盘摘要与数据文件已放在右侧产物区，可继续追问或查看变更。':task.status==='review'?'发现 2 条需人工复核的风险项，结果已放在右侧。':'当前正在提取会议记录中的待办与负责人。'}</p>${steps}${resultChips}`;
    } else if (task.mode === 'Plan') {
      assistantMessage = `<p>${task.confirmed?'已确认以下计划。':'先确认任务计划，再进入执行阶段。'}当前是交互原型，不会实际运行 AI 或改动文件。</p><div class="execution-card"><div class="execution-card-head">${icon('target')} 计划草案 <span style="margin-left:auto;font-weight:500">${task.confirmed?'已确认':'待审阅'}</span></div><div class="execution-steps"><div class="execution-step pending">${icon('clock')}<span>确认目标、工作空间和输入资料</span></div><div class="execution-step pending">${icon('clock')}<span>调用适合的专家与技能处理任务</span></div><div class="execution-step pending">${icon('clock')}<span>核对结果并交付产物</span></div></div></div>${task.confirmed?'':`<button class="primary-button" style="margin-top:11px" data-action="confirm-plan">${icon('play')} 确认计划（演示）</button>`}`;
    } else if (task.mode === 'Ask') {
      assistantMessage = '<p>已进入仅问答模式。正式产品会在这里回答问题，不执行文件操作；当前原型不连接模型服务。</p>';
    } else {
      assistantMessage = '<p>任务界面已创建。这是一份交互原型，任务执行、文件修改和 AI 回复均未连接真实服务。</p>';
    }
    return `<div class="task-page ${state.resultOpen?'':'result-closed'}"><div class="task-page-header"><button class="icon-button" data-page="home" aria-label="返回首页">${icon('right')}</button><div class="title-stack"><h1>${esc(task.title)}</h1><small>${esc(task.owner)} · ${esc(task.time)}${task.mode?' · '+esc(task.mode):''}${task.model?' · '+esc(task.model):''}</small></div><span class="status-pill ${esc(task.status)}"><span class="status-dot ${esc(task.status)}"></span>${esc(task.statusText)}</span><button class="outline-button" data-action="toggle-results">${icon('panel')} ${state.resultOpen?'收起结果':'查看结果'}</button></div>
      <div class="task-page-body"><div class="task-main"><div class="task-conversation"><div class="thread-date">今天 · 任务对话</div><div class="message-block"><span class="avatar avatar-user">张</span><div class="message-body"><div class="message-meta"><strong>张伟</strong>发起任务</div><div class="message-text"><div class="user-message-box">${esc(task.prompt)}</div>${task.attachments?.length?`<div class="result-chip-row">${task.attachments.map(name=>`<span class="result-chip">${icon('file')}${esc(name)}</span>`).join('')}</div>`:''}</div></div></div>
      <div class="message-block"><span class="avatar avatar-ai">${icon('spark')}</span><div class="message-body"><div class="message-meta"><strong>欢网 Buddy</strong>${task.demo?'示例执行记录':'交互原型'}</div><div class="message-text">${assistantMessage}</div></div></div>
      ${(task.followups||[]).map(message => `<div class="message-block"><span class="avatar avatar-user">张</span><div class="message-body"><div class="message-meta"><strong>张伟</strong>继续对话</div><div class="message-text"><div class="user-message-box">${esc(message)}</div></div></div></div>`).join('')}
      </div><div class="task-composer-wrap">${composer(true)}</div></div>${resultPanel(task)}</div></div>`;
  }

  function resultPanel(task) {
    let body = '';
    if (state.resultTab === 'artifacts') {
      body = `<div class="result-summary"><span class="eyebrow">任务产物</span><strong>${task.files.length ? `${task.files.length} 个可查看文件` : '等待任务产物'}</strong><p>${task.files.length ? '点击文件查看示例预览' : '当前任务尚无产物，原型不会生成真实文件。'}</p></div><div class="panel-label">产物列表</div>${task.files.length ? task.files.map((file,index) => panelFile(file,index)).join('') : '<div class="empty-state">暂无产物</div>'}`;
    } else if (state.resultTab === 'files') {
      body = `<div class="panel-label">当前工作空间 · ${esc(task.workspace || state.workspace)}</div>${task.files.length ? task.files.map((file,index) => panelFile(file,index)).join('') : '<div class="empty-state">此任务还没有文件</div>'}<div class="info-banner" style="margin-top:15px">文件操作以授权工作空间为边界；这里只展示原型数据。</div>`;
    } else if (state.resultTab === 'changes') {
      body = task.files.length ? `<div class="panel-label">本次任务的示例变更</div>${task.files.map(file => `<div class="change-row">${icon('file')}<span>新增 ${esc(file.name)}</span></div>`).join('')}<div class="info-banner" style="margin-top:15px">真实产品应提供文件差异和审阅记录。</div>` : '<div class="empty-state">暂无文件变更</div>';
    } else {
      const file = task.files[state.previewFile || 0];
      body = file ? `<div class="panel-label">文件预览 · ${esc(file.name)}</div><div class="preview-paper"><h3>${esc(file.name.replace(/\.[^.]+$/,''))}</h3><p>示例预览：${task.title}。在正式产品中可在此查看、编辑和核对完整产物。</p><ul><li>任务目标与数据来源</li><li>关键发现及风险提示</li><li>后续行动建议</li></ul><div class="preview-line"></div><div class="preview-line"></div><div class="preview-line short"></div></div>` : '<div class="empty-state">选择产物后在此预览</div>';
    }
    return `<aside class="result-panel" aria-label="任务结果"><div class="result-panel-header"><span>任务结果</span><button class="icon-button" data-action="toggle-results" aria-label="关闭结果面板">${icon('close')}</button></div><div class="result-tabs">${[['artifacts','产物'],['files','全部文件'],['changes','变更'],['preview','预览']].map(([key,label])=>`<button class="result-tab ${state.resultTab===key?'active':''}" data-result-tab="${key}">${label}</button>`).join('')}</div><div class="result-panel-body">${body}</div></aside>`;
  }

  function panelFile(file,index) { return `<button class="panel-file" data-file="${index}">${icon(file.icon)}<span><strong>${esc(file.name)}</strong><small>${esc(file.type)} · ${esc(file.size)}</small></span>${icon('right','file-arrow')}</button>`; }

  function assistantView() {
    return `<div class="content-page">${header('远程协同','助理','在企业微信等已连接渠道接收任务、跟进进度和取回产物。','<button class="primary-button" data-page="home">'+icon('plus')+' 发起新任务</button>')}
      <div class="info-banner"><strong>多端协同示意</strong>　当前原型展示助理入口与任务归集，尚未连接真实消息渠道。</div><div class="feature-grid"><button class="feature-card" data-task="task-3"><div class="feature-card-head"><span class="template-icon">${icon('message')}</span><span class="status-pill">已连接</span></div><h3>企业微信助理</h3><p>在群聊或单聊中发送任务指令，同步查看执行状态。</p><div class="feature-card-footer"><span>查看最近对话</span>${icon('arrow')}</div></button><button class="feature-card" data-task="task-1"><div class="feature-card-head"><span class="template-icon yellow">${icon('bell')}</span><span class="status-pill review">2 条待处理</span></div><h3>任务通知</h3><p>产物完成、待审核事项和需要确认的操作集中提醒。</p><div class="feature-card-footer"><span>查看任务结果</span>${icon('arrow')}</div></button><button class="feature-card" data-page="extensions"><div class="feature-card-head"><span class="template-icon blue">${icon('link')}</span></div><h3>连接外部服务</h3><p>通过连接器接入团队知识与授权业务服务。</p><div class="feature-card-footer"><span>管理连接器</span>${icon('arrow')}</div></button></div></div>`;
  }

  function projectsView() {
    return `<div class="content-page">${header('团队协作','项目','将任务、AI 成员与产物归集到统一空间。','<button class="primary-button" data-action="new-project">'+icon('plus')+' 新建项目</button>')}
      <div class="feature-grid">${projects.map(project => `<button class="feature-card" data-page="board"><div class="feature-card-head"><span class="template-icon ${project.tone==='orange'?'':project.tone}">${icon(project.icon)}</span><span class="muted-stat">${project.progress}%</span></div><h3>${esc(project.name)}</h3><p>${esc(project.description)}</p><div class="mini-progress"><span style="width:${project.progress}%"></span></div><div class="feature-card-footer"><span>${esc(project.items)}</span>${icon('arrow')}</div></button>`).join('')}</div><div class="section-block"><h2>跨项目任务</h2><div class="list-surface">${tasks.map(task => `<button class="list-row" data-task="${esc(task.id)}"><span class="list-row-icon">${icon('target')}</span><span class="list-row-main"><strong>${esc(task.title)}</strong><small>${esc(task.owner)} · ${esc(task.time)}</small></span><span class="status-pill ${esc(task.status)}">${esc(task.statusText)}</span>${icon('right')}</button>`).join('')}</div></div></div>`;
  }

  function boardView() {
    const columns = [['running','进行中'],['review','待审核'],['done','已完成']];
    return `<div class="content-page">${header('任务协作','任务看板','从发起、执行到验收，集中跟踪人和 AI 成员的工作。','<button class="primary-button" data-page="home">'+icon('plus')+' 新建任务</button>')}
      <div class="feature-grid">${columns.map(([status,label])=>`<div class="surface-card" style="padding:15px;min-height:195px"><div style="font-weight:700;margin-bottom:15px;font-size:12px"><span class="status-dot ${status}"></span>${label} <span class="muted-stat">${tasks.filter(task=>task.status===status).length}</span></div>${tasks.filter(task=>task.status===status).map(task=>`<button class="panel-file" data-task="${esc(task.id)}" style="margin-bottom:8px"><span><strong>${esc(task.title)}</strong><small>${esc(task.owner)} · ${esc(task.time)}</small></span>${icon('right','file-arrow')}</button>`).join('') || '<div class="empty-state">暂无任务</div>'}</div>`).join('')}</div></div>`;
  }

  function membersView() {
    return `<div class="content-page">${header('人机协作','AI 成员','将模型、专家、技能和连接器组合成可复用的 Agent。','<button class="outline-button" data-action="open-agent-center">'+icon('box')+' 管理 Agent</button>')}
      <div class="info-banner"><strong>权限边界</strong>　AI 成员的有效权限以创建者授权为上限，任务行为同时记录 AI 主体与发起人。</div><div class="feature-grid">${extensions.agents.map(agent=>capabilityCard(agent,'agents')).join('')}</div></div>`;
  }

  function capabilityCard(item,kind) {
    const safeIcon = ['spark','chart','shield','message','book','database','box','folder','file','target','globe','team','zap','link'].includes(item.icon) ? item.icon : 'box';
    const tone = ['yellow','blue','green'].includes(item.tone) ? item.tone : '';
    const enabled = kind === 'connectors' ? !!item.connected : item.enabled !== false;
    const status = kind === 'connectors' ? (enabled?'已连接':'待连接') : (enabled?'已启用':'已停用');
    const detail = kind === 'agents' ? `<div class="capability-tags"><span>${icon('spark')} ${esc(item.model || '未选择模型')}</span><span>${icon('team')} ${esc(item.expert || '未指定专家')}</span><span>${icon('zap')} ${esc(item.skills || '未配置技能')}</span><span>${icon('link')} ${esc(item.connector || '未配置连接器')}</span></div>` : '';
    const action = kind === 'connectors'
      ? `<button class="text-link" data-connector-id="${esc(item.id)}">${enabled?'管理连接':'连接服务'} ${icon('arrow')}</button>`
      : `<button class="text-link" data-use-prompt="${esc(item.prompt || `请使用${item.name}完成任务。`)}">立即使用 ${icon('arrow')}</button>`;
    return `<div class="feature-card capability-card"><div class="feature-card-head"><span class="template-icon ${tone}">${icon(safeIcon)}</span><span class="status-pill ${enabled?'done':'paused'}">${status}</span></div><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p>${detail}<div class="feature-card-footer"><span>${esc(item.meta || extensionLabels[kind])}</span><div class="capability-actions"><button class="outline-button edit-capability-button" data-edit-capability="${esc(item.id)}" data-capability-kind="${kind}">${icon('sliders')} 在线编辑</button>${action}</div></div></div>`;
  }

  function extensionsView() {
    const tabs = Object.entries(extensionLabels);
    const kind = state.extensionTab;
    const items = extensions[kind].filter(item => `${item.name}${item.description}${item.meta || ''}`.toLowerCase().includes(state.filter.toLowerCase()));
    return `<div class="content-page">${header('能力中心','Agent · 专家 · 技能 · 连接器','在线配置 Agent 的模型、专家、技能与连接器，并复用到任务中。',`<button class="primary-button" data-action="new-capability">${icon('plus')} 新建${extensionLabels[kind]}</button>`)}
      <div class="content-toolbar"><div class="segmented capability-tabs">${tabs.map(([key,label])=>`<button class="${kind===key?'active':''}" data-extension-tab="${key}">${label}</button>`).join('')}</div><label class="search-field">${icon('search')}<input id="listSearch" type="search" placeholder="搜索${extensionLabels[kind]}" value="${esc(state.filter)}"></label></div>
      <div class="info-banner capability-intro"><strong>${extensionLabels[kind]} 配置</strong>　点击卡片中的「在线编辑」修改内容，保存后即时更新；原型将修改保存在当前浏览器。</div>
      <div class="feature-grid capability-grid">${items.map(item=>capabilityCard(item,kind)).join('') || '<div class="empty-state">没有匹配的内容</div>'}</div></div>`;
  }

  function scheduleView() {
    return `<div class="content-page">${header('自动化','定时任务','让重复工作按计划运行，执行记录和产物统一回到任务中心。','<button class="primary-button" data-action="new-schedule">'+icon('plus')+' 新建定时任务</button>')}
      <div class="info-banner"><strong>执行说明</strong>　原型中的开关和新增操作只改变当前页面展示，不会真正创建系统计划。</div><div class="list-surface">${schedules.map(item=>`<div class="list-row"><span class="list-row-icon">${icon('clock')}</span><span class="list-row-main"><strong>${esc(item.title)}</strong><small>${esc(item.when)} · ${esc(item.agent)}</small></span><span class="status-pill ${item.enabled?'done':'paused'}">${item.enabled?'已启用':'已暂停'}</span><input class="toggle" type="checkbox" data-schedule-toggle="${esc(item.id)}" ${item.enabled?'checked':''} aria-label="切换 ${esc(item.title)}"></div>`).join('')}</div></div>`;
  }

  function libraryView() {
    const tabs = [['all','全部资料'],['team','团队空间'],['mine','我的文档']];
    const items = library.filter(item => (state.libraryTab==='all' || (state.libraryTab==='team'?item.type==='团队空间':item.type==='我的文档')) && `${item.name}${item.description}`.toLowerCase().includes(state.filter.toLowerCase()));
    return `<div class="content-page">${header('知识与文件','资料库','统一管理团队文档、工作资料和 AI 任务产物。','<button class="outline-button" data-action="upload-library">'+icon('plus')+' 添加资料</button>')}
      <div class="content-toolbar"><div class="segmented">${tabs.map(([key,label])=>`<button class="${state.libraryTab===key?'active':''}" data-library-tab="${key}">${label}</button>`).join('')}</div><label class="search-field">${icon('search')}<input id="listSearch" type="search" placeholder="搜索资料" value="${esc(state.filter)}"></label></div>
      <div class="feature-grid">${items.map((item,index)=>`<button class="feature-card" data-library-item="${esc(item.name)}"><div class="feature-card-head"><span class="template-icon ${item.tone==='orange'?'':item.tone}">${icon(item.icon)}</span><span class="muted-stat">${esc(item.type)}</span></div><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p><div class="feature-card-footer"><span>${esc(item.meta)}</span>${icon('arrow')}</div></button>`).join('') || '<div class="empty-state">没有匹配的资料</div>'}</div></div>`;
  }

  function governanceView() {
    return `<div class="content-page">${header('管理设置','模型与安全','模型切换、权限边界、审计和用量在一个空间内管理。')}
      <div class="feature-grid"><button class="feature-card" data-action="model"><div class="feature-card-head"><span class="template-icon">${icon('spark')}</span><span class="status-pill done">当前使用</span></div><h3>模型配置</h3><p>按任务选择模型，查看可用状态与场景路由。</p><div class="feature-card-footer"><span>${esc(state.model)}</span>${icon('arrow')}</div></button><button class="feature-card" data-action="show-permissions"><div class="feature-card-head"><span class="template-icon yellow">${icon('shield')}</span></div><h3>权限与安全</h3><p>工作空间授权、敏感操作确认和 AI 成员权限边界。</p><div class="feature-card-footer"><span>默认权限</span>${icon('arrow')}</div></button><button class="feature-card" data-action="show-audit"><div class="feature-card-head"><span class="template-icon blue">${icon('file')}</span></div><h3>审计与配额</h3><p>追踪任务发起人、AI 执行主体和模型使用记录。</p><div class="feature-card-footer"><span>查看示例记录</span>${icon('arrow')}</div></button></div>
      <div class="section-block"><h2>空间安全概览</h2><div class="list-surface"><div class="list-row"><span class="list-row-icon">${icon('shield')}</span><span class="list-row-main"><strong>敏感操作确认</strong><small>文件修改与外部服务调用需要按权限规则确认</small></span><span class="status-pill done">已启用</span></div><div class="list-row"><span class="list-row-icon">${icon('team')}</span><span class="list-row-main"><strong>AI 成员权限上限</strong><small>不超过创建者或所属成员的可用范围</small></span><span class="status-pill done">已启用</span></div><div class="list-row"><span class="list-row-icon">${icon('file')}</span><span class="list-row-main"><strong>双主体审计</strong><small>同时记录执行 Agent 与任务发起人</small></span><span class="status-pill done">已启用</span></div></div></div></div>`;
  }

  function openModal(title, subtitle, content) {
    $('#modal').classList.remove('editor-modal');
    $('#modalContent').innerHTML = `<h2>${title}</h2><p>${subtitle}</p>${content}`;
    $('#modal').showModal();
  }

  function closeModal() {
    const modal = $('#modal');
    if (modal.open) modal.close();
    state.editingCapability = null;
    modal.classList.remove('editor-modal');
  }

  function selectOptions(values,current) {
    return [...new Set([...values,current].filter(Boolean))].map(value => `<option value="${esc(value)}" ${value===current?'selected':''}>${esc(value)}</option>`).join('');
  }

  function openCapabilityEditor(kind,id = null) {
    if (!extensionLabels[kind]) return;
    const item = id ? extensions[kind].find(value => value.id === id) : null;
    if (id && !item) { toast('未找到要编辑的内容'); return; }
    state.editingCapability = {kind,id};
    const label = extensionLabels[kind];
    const editing = !!item;
    const current = item || {name:'',description:'',meta:'',icon:kind==='agents'?'spark':kind==='experts'?'team':kind==='skills'?'zap':'link',tone:'orange',enabled:true,connected:false,prompt:'',model:state.model,expert:extensions.experts[0]?.name || '',skills:'',connector:extensions.connectors[0]?.name || '',endpoint:'',scope:''};
    const enabled = kind==='connectors' ? !!current.connected : current.enabled !== false;
    const iconChoices = [['spark','灵感'],['chart','图表'],['shield','安全'],['team','成员'],['zap','技能'],['book','资料'],['link','连接'],['database','数据'],['box','应用']];
    const previewIcon = iconChoices.some(([value]) => value === current.icon) ? current.icon : 'box';
    const extra = kind==='agents' ? `
      <div class="form-row"><label for="capModel">默认模型</label><select id="capModel">${selectOptions(['Claude Sonnet 4.5','Claude Opus 4.5','DeepSeek V3','腾讯混元'],current.model)}</select></div>
      <div class="form-row"><label for="capExpert">关联专家</label><select id="capExpert">${selectOptions(extensions.experts.map(value=>value.name),current.expert)}</select></div>
      <div class="form-row"><label for="capSkills">调用技能</label><input id="capSkills" maxlength="120" value="${esc(current.skills || '')}" placeholder="多个技能用顿号分隔"></div>
      <div class="form-row"><label for="capConnector">连接器</label><select id="capConnector">${selectOptions(extensions.connectors.map(value=>value.name),current.connector)}</select></div>
      <div class="form-row"><label for="capPrompt">Agent 指令</label><textarea id="capPrompt" placeholder="描述 Agent 如何处理任务">${esc(current.prompt || '')}</textarea></div>`
      : kind==='connectors' ? `<div class="form-row"><label for="capEndpoint">服务地址（展示用）</label><input id="capEndpoint" type="url" value="${esc(current.endpoint || '')}" placeholder="https://example.com/api"></div><div class="form-row"><label for="capScope">授权范围</label><input id="capScope" value="${esc(current.scope || '')}" placeholder="例如：只读数据查询"></div>`
      : `<div class="form-row"><label for="capPrompt">${kind==='skills'?'技能指令':'专家提示词'}</label><textarea id="capPrompt" placeholder="输入使用时的任务说明">${esc(current.prompt || '')}</textarea></div>`;
    const content = `<div class="cap-editor-grid"><div class="cap-editor-fields">
      <div class="form-row"><label for="capName">名称 <span class="required-mark">*</span></label><input id="capName" maxlength="40" value="${esc(current.name)}" placeholder="输入${label}名称" required></div>
      <div class="form-row"><label for="capDescription">简介 <span class="required-mark">*</span></label><textarea id="capDescription" maxlength="240" placeholder="描述适用场景和能力" required>${esc(current.description)}</textarea></div>
      <div class="form-row"><label for="capMeta">卡片补充信息</label><input id="capMeta" maxlength="80" value="${esc(current.meta || '')}" placeholder="例如：团队共享 · v1.0"></div>
      <div class="cap-editor-pair"><div class="form-row"><label for="capIcon">图标</label><select id="capIcon">${iconChoices.map(([value,text])=>`<option value="${value}" ${current.icon===value?'selected':''}>${text}</option>`).join('')}</select></div><div class="form-row"><label for="capTone">强调色</label><select id="capTone">${[['orange','欢网橘'],['yellow','暖黄'],['blue','浅蓝'],['green','青绿']].map(([value,text])=>`<option value="${value}" ${current.tone===value?'selected':''}>${text}</option>`).join('')}</select></div></div>
      ${extra}<label class="cap-editor-switch"><span><strong>${kind==='connectors'?'示例连接状态':'启用状态'}</strong><small>${kind==='connectors'?'仅展示状态，不进行真实授权':'停用后仍保留配置，可继续编辑'}</small></span><input id="capEnabled" class="toggle" type="checkbox" ${enabled?'checked':''}></label>
      </div><aside class="cap-editor-preview"><div class="panel-label">实时预览</div><div class="feature-card capability-card preview-card"><div class="feature-card-head"><span class="template-icon" id="capPreviewIcon">${icon(previewIcon)}</span><span class="status-pill ${enabled?'done':'paused'}" id="capPreviewStatus">${enabled?(kind==='connectors'?'已连接':'已启用'):(kind==='connectors'?'待连接':'已停用')}</span></div><h3 id="capPreviewName">${esc(current.name || `${label}名称`)}</h3><p id="capPreviewDescription">${esc(current.description || '这里会同步展示正在编辑的简介。')}</p><div class="cap-preview-detail" id="capPreviewDetail">${kind==='agents'?esc(current.model || '未选择模型'):esc(current.meta || label)}</div></div><div class="cap-preview-note">保存后会立即更新卡片，并存入当前浏览器的本地存储。</div></aside></div>
      <div class="modal-actions cap-editor-actions"><button type="button" class="outline-button" data-action="close-modal">取消</button><button type="button" class="primary-button" data-action="save-capability">${icon('check')} ${editing?'保存修改':'创建'+label}</button></div>`;
    openModal(`${editing?'编辑':'新建'}${label}`,'直接在页面中修改配置，右侧会同步预览。',content);
    $('#modal').classList.add('editor-modal');
    $('#capName').focus();
  }

  function updateCapabilityPreview() {
    if (!state.editingCapability || !$('#capPreviewName')) return;
    const kind = state.editingCapability.kind;
    $('#capPreviewName').textContent = $('#capName').value.trim() || `${extensionLabels[kind]}名称`;
    $('#capPreviewDescription').textContent = $('#capDescription').value.trim() || '这里会同步展示正在编辑的简介。';
    const enabled = $('#capEnabled').checked;
    $('#capPreviewStatus').textContent = enabled ? (kind==='connectors'?'已连接':'已启用') : (kind==='connectors'?'待连接':'已停用');
    $('#capPreviewStatus').className = `status-pill ${enabled?'done':'paused'}`;
    $('#capPreviewIcon').className = `template-icon ${$('#capTone').value==='orange'?'':$('#capTone').value}`;
    $('#capPreviewIcon').innerHTML = icon($('#capIcon').value);
    $('#capPreviewDetail').textContent = kind==='agents' ? ($('#capModel').value || '未选择模型') : ($('#capMeta').value || extensionLabels[kind]);
  }

  function saveCapability() {
    const editing = state.editingCapability;
    if (!editing) return;
    const {kind,id} = editing;
    const name = $('#capName').value.trim();
    const description = $('#capDescription').value.trim();
    if (!name) { toast('请输入名称'); $('#capName').focus(); return; }
    if (!description) { toast('请输入简介'); $('#capDescription').focus(); return; }
    if (extensions[kind].some(item => item.id !== id && item.name === name)) { toast('该名称已存在'); $('#capName').focus(); return; }
    const item = id ? extensions[kind].find(value=>value.id===id) : {id:`${kind}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`};
    if (!item) { toast('内容已不存在，请重新打开编辑器'); return; }
    Object.assign(item,{name,description,meta:$('#capMeta').value.trim(),icon:$('#capIcon').value,tone:$('#capTone').value});
    if (kind==='connectors') { item.connected=$('#capEnabled').checked; item.endpoint=$('#capEndpoint').value.trim(); item.scope=$('#capScope').value.trim(); }
    else { item.enabled=$('#capEnabled').checked; item.prompt=$('#capPrompt').value.trim(); }
    if (kind==='agents') Object.assign(item,{model:$('#capModel').value,expert:$('#capExpert').value,skills:$('#capSkills').value.trim(),connector:$('#capConnector').value});
    if (!id) extensions[kind].unshift(item);
    const persisted = saveExtensions();
    closeModal(); state.filter=''; render();
    toast(`${extensionLabels[kind]}已${id?'更新':'创建'}${persisted?'并保存到当前浏览器':'；本次修改仅在当前页面有效'}`);
  }

  function chooseModal(kind) {
    if (kind==='model') {
      openModal('选择模型','原型仅展示模型切换控件；不会调用模型服务。', ['Claude Sonnet 4.5','Claude Opus 4.5','DeepSeek V3','腾讯混元'].map(name=>`<button type="button" class="list-row" data-select-model="${esc(name)}"><span class="list-row-icon">${icon('spark')}</span><span class="list-row-main"><strong>${esc(name)}</strong><small>${name===state.model?'当前模型':'选择后用于新任务展示'}</small></span>${name===state.model?icon('check'):icon('right')}</button>`).join(''));
    } else if (kind==='mode') {
      openModal('选择工作模式','Agent 直接执行；Plan 先展示方案；Ask 用于问答。', [['Agent','默认执行模式'],['Plan','先规划，确认后执行'],['Ask','仅问答，不执行操作']].map(([mode,description])=>`<button type="button" class="list-row" data-select-mode="${mode}"><span class="list-row-icon">${icon(mode==='Agent'?'zap':mode==='Plan'?'target':'message')}</span><span class="list-row-main"><strong>${mode}</strong><small>${description}</small></span>${mode===state.mode?icon('check'):icon('right')}</button>`).join(''));
    } else if (kind==='workspace') {
      openModal('选择工作空间','任务资料与产物归入选定空间。', ['欢网 · 平台产品组','智能大屏增长计划','OTT 素材合规专项'].map(name=>`<button type="button" class="list-row" data-select-workspace="${esc(name)}"><span class="list-row-icon">${icon('folder')}</span><span class="list-row-main"><strong>${esc(name)}</strong><small>${name===state.workspace?'当前空间':'选择工作空间'}</small></span>${name===state.workspace?icon('check'):icon('right')}</button>`).join(''));
    }
  }

  function createTask() {
    const prompt = state.draft.trim();
    if (!prompt && state.attachments.length === 0) { toast('请先描述任务或添加文件'); $('#taskInput')?.focus(); return; }
    if (state.page === 'task') {
      const task = tasks.find(item => item.id === state.activeTask);
      if (task) { task.followups = task.followups || []; task.followups.push(prompt || `附加文件：${state.attachments.join('、')}`); }
      state.draft=''; state.attachments=[];
      render();
      toast('已加入当前任务的对话记录（原型演示）');
      return;
    }
    const task = {id:`task-${Date.now()}`,title:prompt.slice(0,24) || `处理 ${state.attachments.length} 个文件`,prompt:prompt || `请处理附件：${state.attachments.join('、')}`,status:state.mode==='Plan'?'review':'running',statusText:state.mode==='Plan'?'待确认计划':state.mode==='Ask'?'仅问答':'原型演示',time:'刚刚',owner:'欢网 Buddy',files:[],steps:[],demo:false,mode:state.mode,model:state.model,workspace:state.workspace,attachments:[...state.attachments]};
    tasks.unshift(task); state.activeTask=task.id; state.draft=''; state.attachments=[]; state.resultTab='artifacts'; state.resultOpen=true;
    setPage('task',task.id);
    toast('任务界面已创建（交互原型，不执行真实 AI）');
  }

  function openSearch() {
    openModal('搜索任务与资料','输入关键词筛选当前原型中的示例内容。',`<label class="search-field" style="width:100%">${icon('search')}<input id="globalSearch" type="search" placeholder="搜索任务、资料、技能…"></label><div id="searchResults" class="list-surface" style="margin-top:12px"></div>`);
    $('#globalSearch').focus(); updateGlobalSearch('');
  }
  function updateGlobalSearch(query) {
    const q=query.trim().toLowerCase();
    const hits=[...tasks.map(item=>({title:item.title,sub:'任务 · '+item.statusText,icon:'target',task:item.id})),...library.map(item=>({title:item.name,sub:'资料 · '+item.type,icon:'book',library:item.name}))].filter(item=>!q || `${item.title}${item.sub}`.toLowerCase().includes(q)).slice(0,8);
    $('#searchResults').innerHTML=hits.map(item=>`<button type="button" class="list-row" ${item.task?`data-task="${esc(item.task)}"`:`data-library-item="${esc(item.library)}"`}><span class="list-row-icon">${icon(item.icon)}</span><span class="list-row-main"><strong>${esc(item.title)}</strong><small>${esc(item.sub)}</small></span>${icon('right')}</button>`).join('') || '<div class="empty-state">没有找到匹配内容</div>';
  }

  function openNotifications() {
    openModal('消息中心','查看待审核事项和最近完成的任务。',`<button type="button" class="list-row" data-task="task-2"><span class="list-row-icon">${icon('shield')}</span><span class="list-row-main"><strong>素材合规任务待审核</strong><small>AI·质量巡检标记了 2 条需人工复核的内容</small></span>${icon('right')}</button><button type="button" class="list-row" data-task="task-1"><span class="list-row-icon">${icon('check')}</span><span class="list-row-main"><strong>渠道投放复盘已完成</strong><small>周报与数据表已放入产物区</small></span>${icon('right')}</button>`);
  }

  function closeSidebar() { $('#sidebar').classList.remove('open'); $('#mobileScrim').classList.remove('open'); }

  document.addEventListener('click', (event) => {
    const target = event.target.closest('button, input[data-schedule-toggle]');
    if (!target) return;
    if (target.dataset.page) { closeModal(); setPage(target.dataset.page); return; }
    if (target.dataset.task) { closeModal(); setPage('task',target.dataset.task); return; }
    if (target.dataset.category) { state.category=target.dataset.category; render(); return; }
    if (target.dataset.templateCategory) { state.category=target.dataset.templateCategory; render(); return; }
    if (target.dataset.template) { const item=templates.find(value=>value.id===target.dataset.template); if(item){state.draft=item.prompt; $('#taskInput').value=state.draft; $('#taskInput').focus(); window.scrollTo(0,0); $('#mainContent').scrollTop=0; toast('已填入任务描述，可修改后发送');} return; }
    if (target.dataset.usePrompt) { state.draft=target.dataset.usePrompt; closeModal(); setPage('home'); $('#taskInput')?.focus(); toast('已填入任务描述，可修改后发送'); return; }
    if (target.dataset.extensionTab) { state.extensionTab=target.dataset.extensionTab; state.filter=''; render(); return; }
    if (target.dataset.editCapability) { openCapabilityEditor(target.dataset.capabilityKind,target.dataset.editCapability); return; }
    if (target.dataset.libraryTab) { state.libraryTab=target.dataset.libraryTab; state.filter=''; render(); return; }
    if (target.dataset.resultTab) { state.resultTab=target.dataset.resultTab; render(); return; }
    if (target.dataset.file !== undefined) { state.previewFile=Number(target.dataset.file); state.resultTab='preview'; state.resultOpen=true; render(); return; }
    if (target.dataset.removeAttachment !== undefined) { state.attachments.splice(Number(target.dataset.removeAttachment),1); render(); $('#taskInput')?.focus(); return; }
    if (target.dataset.selectModel) { state.model=target.dataset.selectModel; closeModal(); render(); toast(`已选择 ${state.model}`); return; }
    if (target.dataset.selectMode) { state.mode=target.dataset.selectMode; closeModal(); render(); toast(`已切换为 ${state.mode} 模式`); return; }
    if (target.dataset.selectWorkspace) { state.workspace=target.dataset.selectWorkspace; closeModal(); render(); toast(`工作空间：${state.workspace}`); return; }
    if (target.dataset.connectorId) { const connector=extensions.connectors.find(item=>item.id===target.dataset.connectorId); if(!connector) return; openModal(esc(connector.name),'连接器设置（原型演示）',`<div class="info-banner">正式产品会通过授权流程管理连接器。这里仅演示连接状态。</div><div class="list-row"><span class="list-row-icon">${icon('link')}</span><span class="list-row-main"><strong>${esc(connector.name)}</strong><small>${connector.connected?'已连接当前工作空间':'尚未连接'}</small></span><span class="status-pill ${connector.connected?'done':''}">${connector.connected?'已连接':'待连接'}</span></div><div class="modal-actions"><button type="button" class="outline-button" data-action="close-modal">关闭</button><button type="button" class="primary-button" data-action="toggle-connector" data-toggle-connector-id="${esc(connector.id)}">${connector.connected?'断开示例连接':'连接示例服务'}</button></div>`); return; }
    if (target.dataset.libraryItem) { closeModal(); const item=library.find(value=>value.name===target.dataset.libraryItem); if(item) openModal(esc(item.name),esc(item.type),`<div class="preview-paper"><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p><p>最近更新：${esc(item.meta)}</p><div class="preview-line"></div><div class="preview-line"></div><div class="preview-line short"></div></div><div class="modal-actions"><button type="button" class="outline-button" data-action="close-modal">关闭</button><button type="button" class="primary-button" data-use-prompt="请基于${esc(item.name)}回答我的问题。">用于新任务</button></div>`); return; }
    if (target.dataset.scheduleToggle) { const item=schedules.find(value=>value.id===target.dataset.scheduleToggle); if(item){item.enabled=target.checked; render(); toast(`${item.title}已${item.enabled?'启用':'暂停'}（原型演示）`);} return; }
    const action=target.dataset.action;
    if (action==='open-agent-center') { state.extensionTab='agents'; setPage('extensions'); return; }
    if (action==='new-capability') { openCapabilityEditor(state.extensionTab); return; }
    if (action==='save-capability') { saveCapability(); return; }
    if (action==='new-task') { state.draft=''; state.attachments=[]; state.mode='Agent'; setPage('home'); $('#taskInput')?.focus(); return; }
    if (action==='attach') { $('#attachmentInput')?.click(); return; }
    if (action==='send') { createTask(); return; }
    if (action==='confirm-plan') { const task=tasks.find(item=>item.id===state.activeTask); if(task){task.confirmed=true;task.status='running';task.statusText='原型演示';render();toast('计划已确认（原型不执行真实任务）');} return; }
    if (['model','mode','workspace'].includes(action)) { chooseModal(action); return; }
    if (action==='toggle-results') { state.resultOpen=!state.resultOpen; render(); return; }
    if (action==='close-modal') { closeModal(); return; }
    if (action==='toggle-connector') { const connector=extensions.connectors.find(item=>item.id===target.dataset.toggleConnectorId); if(connector){connector.connected=!connector.connected;connector.meta=connector.connected?'已连接 · 欢网企业空间':'待连接 · 需空间管理员授权';const persisted=saveExtensions();closeModal();render();toast(`${connector.name}已${connector.connected?'连接':'断开'}${persisted?'并保存到当前浏览器':'（本次页面有效）'}`);} return; }
    if (action==='new-schedule') { openModal('新建定时任务','添加一条示例计划，便于评审自动化入口。',`<div class="form-row"><label for="scheduleName">任务名称</label><input id="scheduleName" placeholder="例如：每周渠道复盘" required></div><div class="form-row"><label for="scheduleFrequency">执行周期</label><select id="scheduleFrequency"><option>每天 09:00</option><option>每周一 09:00</option><option>每月 1 日 10:00</option></select></div><div class="form-row"><label for="scheduleAgent">执行成员</label><select id="scheduleAgent"><option>AI·数据分析师</option><option>AI·质量巡检</option><option>AI·投放文案</option></select></div><div class="form-row"><label for="schedulePrompt">任务描述</label><textarea id="schedulePrompt" placeholder="描述周期性工作内容"></textarea></div><div class="modal-actions"><button type="button" class="outline-button" data-action="close-modal">取消</button><button type="button" class="primary-button" data-action="save-schedule">创建示例任务</button></div>`); return; }
    if (action==='save-schedule') { const name=$('#scheduleName').value.trim(); if(!name){$('#scheduleName').focus();toast('请输入任务名称');return;} schedules.unshift({id:`s${Date.now()}`,title:name,when:$('#scheduleFrequency').value,agent:$('#scheduleAgent').value,enabled:true}); closeModal(); render(); toast('已添加定时任务（原型演示）'); return; }
    if (action==='new-project') { openModal('新建项目','项目创建在原型中仅作流程展示。',`<div class="form-row"><label for="projectName">项目名称</label><input id="projectName" placeholder="例如：新季度增长计划"></div><div class="form-row"><label for="projectDescription">项目说明</label><textarea id="projectDescription" placeholder="描述项目目标与协作范围"></textarea></div><div class="modal-actions"><button type="button" class="primary-button" data-action="save-project">创建示例项目</button></div>`); return; }
    if (action==='save-project') { const name=$('#projectName').value.trim(); if(!name){$('#projectName').focus();toast('请输入项目名称');return;} projects.unshift({name,description:$('#projectDescription').value.trim()||'新的团队协作项目',progress:0,items:'0 项任务 · 待分配成员',icon:'folder',tone:'orange'}); closeModal(); render(); toast('已添加项目（原型演示）'); return; }
    if (action==='upload-library') { openModal('添加资料','原型支持选择本地文件名进行展示，不会上传到服务器。',`<div class="form-row"><label for="libraryUpload">选择文件</label><input id="libraryUpload" type="file" multiple></div><div class="modal-actions"><button type="button" class="primary-button" data-action="save-library">添加到资料库</button></div>`); return; }
    if (action==='save-library') { const files=[...$('#libraryUpload').files]; if(!files.length){toast('请先选择文件');return;} files.forEach(file=>library.unshift({name:file.name,type:'我的文档',icon:'file',tone:'orange',meta:`${Math.ceil(file.size/1024)} KB · 刚刚添加`,description:'从本地添加的原型示例资料'})); closeModal(); render(); toast(`已添加 ${files.length} 个资料条目（原型演示）`); return; }
    if (action==='show-permissions') { openModal('权限与安全','示例展示 WorkBuddy 式权限入口与欢网团队权限原则。',`<div class="list-surface"><div class="list-row"><span class="list-row-icon">${icon('folder')}</span><span class="list-row-main"><strong>工作空间边界</strong><small>任务访问授权范围内的文件和资料</small></span></div><div class="list-row"><span class="list-row-icon">${icon('shield')}</span><span class="list-row-main"><strong>敏感操作确认</strong><small>高风险动作需明确确认</small></span></div><div class="list-row"><span class="list-row-icon">${icon('team')}</span><span class="list-row-main"><strong>AI 权限继承上限</strong><small>不超过创建者的有效权限</small></span></div></div>`); return; }
    if (action==='show-audit') { openModal('审计与配额','示例记录用于评审信息结构，非真实审计数据。',`<div class="list-surface"><div class="list-row"><span class="list-row-icon">${icon('file')}</span><span class="list-row-main"><strong>AI·数据分析师生成复盘周报</strong><small>发起人：张伟 · 今天 10:42 · 成功</small></span></div><div class="list-row"><span class="list-row-icon">${icon('shield')}</span><span class="list-row-main"><strong>AI·质量巡检请求人工复核</strong><small>发起人：张伟 · 今天 09:18 · 待审核</small></span></div></div>`); return; }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id?.startsWith('cap')) updateCapabilityPreview();
    if (event.target.id==='taskInput') state.draft=event.target.value;
    if (event.target.id==='listSearch') { state.filter=event.target.value; const caret=event.target.selectionStart; render(); $('#listSearch')?.focus(); $('#listSearch')?.setSelectionRange(caret,caret); }
    if (event.target.id==='globalSearch') updateGlobalSearch(event.target.value);
  });
  document.addEventListener('change', (event) => {
    if (event.target.id?.startsWith('cap')) updateCapabilityPreview();
    if (event.target.id==='attachmentInput') { state.attachments.push(...[...event.target.files].map(file=>file.name)); render(); $('#taskInput')?.focus(); toast(`已添加 ${event.target.files.length} 个附件名称（原型演示）`); }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey||event.ctrlKey) && event.key.toLowerCase()==='k') { event.preventDefault(); setPage('home'); $('#taskInput')?.focus(); }
    if ((event.metaKey||event.ctrlKey) && event.key.toLowerCase()==='f') { event.preventDefault(); openSearch(); }
    if (event.key==='Enter' && (event.metaKey||event.ctrlKey) && document.activeElement?.id==='taskInput') { event.preventDefault(); createTask(); }
    if (event.key==='Escape') { closeSidebar(); $('#profileMenu').hidden=true; }
  });

  $('#profileButton').addEventListener('click', () => { const menu=$('#profileMenu'); menu.hidden=!menu.hidden; $('#profileButton').setAttribute('aria-expanded',String(!menu.hidden)); });
  $('#notificationButton').addEventListener('click',openNotifications);
  $('#topBellButton').addEventListener('click',openNotifications);
  $('#searchButton').addEventListener('click',openSearch);
  $('#sidebarOpen').addEventListener('click',()=>{$('#sidebar').classList.add('open');$('#mobileScrim').classList.add('open');});
  $('#sidebarClose').addEventListener('click',closeSidebar);
  $('#mobileScrim').addEventListener('click',closeSidebar);
  $('#modal').addEventListener('click',(event)=>{ if(event.target===$('#modal')) closeModal(); });
  $('#modal').addEventListener('submit',(event)=>event.preventDefault());
  $('#modal').addEventListener('close',()=>{ state.editingCapability=null; $('#modal').classList.remove('editor-modal'); });

  function applyHash() {
    const hash=decodeURIComponent(location.hash.slice(1));
    if (hash.startsWith('task/')) {
      const taskId=hash.slice(5);
      if(tasks.some(task=>task.id===taskId)) {
        state.page='task'; state.activeTask=taskId;
        state.resultTab='artifacts'; state.resultOpen=!matchMedia('(max-width: 640px)').matches;
      }
    } else if (['home','assistant','projects','board','members','extensions','schedule','library','governance'].includes(hash)) {
      state.page=hash;
    }
    render();
  }
  window.addEventListener('hashchange',applyHash);
  applyHash();
})();
