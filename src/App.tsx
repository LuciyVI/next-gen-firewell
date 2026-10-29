import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronRight, CircleHelp, Clock3, Crosshair, ExternalLink, FileText, Globe2, Layers3, LockKeyhole, Network, Pause, Play, Radio, RotateCcw, Search, Server, Shield, ShieldAlert, ShieldCheck, ShieldOff, Sparkles, Target, Terminal, Trophy, Volume2, VolumeX, X, Zap } from 'lucide-react'
import usergateLogo from './assets/usergate.svg?raw'
import { createGameState, resolveScenario } from './game'
import type { Scenario } from './scenarios'
import { createScenarioSession } from './session'

type Route = 'fast' | 'full'
type Verdict = 'allow' | 'block'
type Page = 'simulator' | 'collection' | 'journal'
type EventEntry = { id: number; time: string; app: string; verdict: Verdict; route: Route; correct: boolean; message: string }
const storageKey = 'packet-control-record-v1'
function readRecord() { try { return Number(localStorage.getItem(storageKey)) || 0 } catch { return 0 } }
function clock(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` }

function Tag({ children, color = '' }: { children: ReactNode; color?: string }) { return <span className={`tag ${color}`}>{children}</span> }

function Modal({ children, title, onClose, wide = false }: { children: ReactNode; title: string; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const bodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex="0"]')
        if (!nodes?.length) return
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', keydown)
    return () => { document.body.style.overflow = bodyOverflow; window.removeEventListener('keydown', keydown); previous?.focus() }
  }, [onClose])
  return <div className="modal-backdrop" onClick={onClose}><div ref={ref} tabIndex={-1} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}><button className="icon-button modal-close" onClick={onClose} aria-label="Закрыть"><X size={20} /></button>{children}</div></div>
}

function AttackCard({ packet, onClose }: { packet: Scenario; onClose: () => void }) {
  const attack = packet.attack!
  return <Modal title={attack.name} onClose={onClose}>
    <div className="discovery-icon"><ShieldCheck size={31} /></div>
    <div className="eyebrow orange">ДОСЬЕ УГРОЗЫ ОТКРЫТО</div><h2>{attack.name}</h2>
    <div className="attack-tags"><Tag color="orange-tag">{attack.cve || 'Сетевая атака'}</Tag><Tag>{packet.protocol}</Tag></div>
    <p className="modal-description">{attack.description}</p>
    <div className="knowledge-block"><h4><Target size={16} /> Что было под угрозой</h4><p>{attack.impact}</p></div>
    <div className="knowledge-block green-block"><h4><ShieldCheck size={16} /> Как защититься</h4><p>{attack.defense}</p></div>
    <a className="source-link" href={attack.sourceUrl} target="_blank" rel="noreferrer">Подробнее об угрозе <ExternalLink size={14} /></a>
    <button className="primary-button full-width" onClick={onClose}>Продолжить смену <ArrowRight size={16} /></button>
  </Modal>
}

function NetworkMap({ route, enabled, profileAttached, paused, locked, onToggle, onProfileToggle }: { route: Route | null; enabled: boolean; profileAttached: boolean; paused: boolean; locked: boolean; onToggle: () => void; onProfileToggle: () => void }) {
  return <section className={`network-panel panel ${paused ? 'animation-paused' : ''}`} aria-label="Схема обработки трафика">
    <div className="panel-heading"><div><Network size={17} /><h3>Периметр сети</h3><span className="simulation-label">Учебный трафик</span></div><span className="live-status"><span className={paused ? 'status-dot gray' : 'status-dot'} />{paused ? 'ПОТОК ПРИОСТАНОВЛЕН' : 'ПОТОК АКТИВЕН'}</span></div>
    <div className="network-map">
      <svg className="network-lines" viewBox="0 0 1000 180" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="line-gradient"><stop offset="0%" stopColor="#dce3e7"/><stop offset="100%" stopColor="#ed6237"/></linearGradient></defs>
        <path className="connection incoming-line" d="M100 90H340" />
        <path className={`connection ${route === 'fast' ? 'chosen-line' : ''}`} d="M440 90H500Q520 90 520 70V46Q520 30 540 30H820Q840 30 840 50V70Q840 90 860 90H900" />
        <path className={`connection ${route === 'full' ? 'chosen-line' : ''}`} d="M440 90H500Q520 90 520 110V135Q520 150 540 150H820Q840 150 840 130V110Q840 90 860 90H900" />
        <path className="packet-motion" d="M140 90H326" />
      </svg>
      <div className="network-end internet"><div className="node-icon"><Globe2 size={28}/></div><strong>Интернет</strong><span>Входящий трафик</span></div>
      <div className="packet-dots" aria-hidden="true"><i/><i/><i/></div>
      <div className="firewall-node"><div className="firewall-device"><Shield size={32} strokeWidth={1.8}/><div className="device-lights"><i/><i/><i/></div></div><strong>UserGate NGFW</strong><span>Межсетевой экран</span></div>
      <div className={`path-node fast-node ${route === 'fast' ? 'selected' : ''}`}><Zap size={17}/><span><strong>FastPath</strong><small>Ускоренная обработка</small></span><ChevronRight size={15}/></div>
      <div className={`path-node full-node ${route === 'full' ? 'selected' : ''} ${!enabled || !profileAttached ? 'disabled-node' : ''}`}><ShieldCheck size={18}/><span><strong>Полная проверка</strong><small>Полная проверка · IDPS</small></span><span className={`status-dot ${!enabled || !profileAttached ? 'danger-dot' : ''}`}/></div>
      <div className="network-end lan"><div className="node-icon"><Server size={27}/></div><strong>Локальная сеть</strong><span>Защищённый периметр</span></div>
    </div>
    <div className={`idps-strip ${!enabled ? 'idps-warning' : ''}`}><div><span className={`idps-icon ${!enabled ? 'off' : ''}`}>{enabled ? <ShieldCheck size={18}/> : <ShieldOff size={18}/>}</span><strong>Модуль IDPS</strong><span className={`mini-status ${enabled ? '' : 'red-text'}`}>{enabled ? 'Защита активна' : 'Защита отключена'}</span><span className="idps-description">Обнаружение и предотвращение вторжений</span></div><button className={`toggle ${enabled ? 'on' : ''}`} role="switch" aria-checked={enabled} aria-label="Модуль IDPS" onClick={onToggle} disabled={paused || locked}><span/></button></div>
    <div className={`idps-strip profile-strip ${!profileAttached ? 'idps-warning' : ''}`}><div><span className="idps-icon"><Layers3 size={17}/></span><strong>Профиль СОВ</strong><span className={`mini-status ${profileAttached ? '' : 'red-text'}`}>{profileAttached ? 'Назначен правилу' : 'Не назначен'}</span><span className="idps-description">Разрешающее правило «Учебный периметр»</span></div><button className={`toggle ${profileAttached ? 'on' : ''}`} role="switch" aria-checked={profileAttached} aria-label="Профиль СОВ" onClick={onProfileToggle} disabled={paused || locked}><span/></button></div>
  </section>
}

export default function App() {
  const [scenarios, setScenarios] = useState(createScenarioSession)
  const TOTAL = scenarios.length
  const [game, setGame] = useState(createGameState)
  const [page, setPage] = useState<Page>('simulator')
  const [index, setIndex] = useState(0)
  const [route, setRoute] = useState<Route | null>(null)
  const [resolved, setResolved] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [help, setHelp] = useState(false)
  const [restartConfirm, setRestartConfirm] = useState(false)
  const [openAttack, setOpenAttack] = useState<Scenario | null>(null)
  const [events, setEvents] = useState<EventEntry[]>([])
  const [record, setRecord] = useState(readRecord)
  const [search, setSearch] = useState('')
  const [sound, setSound] = useState(false)
  const [notice, setNotice] = useState('')
  const [complete, setComplete] = useState(false)
  const decisionLock = useRef(false)
  const soundContext = useRef<AudioContext | null>(null)
  const packet = scenarios[index]
  const finished = game.gameOver || complete
  const modalOpen = help || restartConfirm || !!openAttack
  const accuracy = game.processed ? Math.round(game.correct / game.processed * 100) : 100
  const attackScenarios = scenarios.filter(s => s.attack)
  const unlocked = attackScenarios.filter(s => game.discoveredIds.includes(s.id))

  useEffect(() => {
    if (paused || finished || modalOpen || page !== 'simulator') return
    const timer = window.setInterval(() => setSeconds(s => s + 1), 1000)
    return () => window.clearInterval(timer)
  }, [paused, finished, modalOpen, page])
  useEffect(() => {
    if (game.score > record) { setRecord(game.score); try { localStorage.setItem(storageKey, String(game.score)) } catch { /* Storage can be disabled. */ } }
  }, [game.score, record])
  useEffect(() => () => { void soundContext.current?.close() }, [])

  function tone(correct: boolean) {
    if (!sound) return
    try {
      const context = soundContext.current ??= new AudioContext()
      void context.resume()
      const osc = context.createOscillator(), gain = context.createGain()
      osc.connect(gain); gain.connect(context.destination); osc.frequency.value = correct ? 660 : 220
      gain.gain.setValueAtTime(0.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.15)
      osc.start(); osc.stop(context.currentTime + 0.15)
    } catch { /* Sound is optional. */ }
  }
  function decide(verdict: Verdict) {
    if (!route || resolved || paused || finished || modalOpen || page !== 'simulator' || decisionLock.current) return
    decisionLock.current = true
    const next = resolveScenario(game, packet, route, verdict)
    setGame(next); setResolved(true)
    const result = next.lastResult!
    setEvents(old => [{ id: next.processed, time: clock(seconds), app: packet.app, route, verdict, correct: result.correct, message: result.feedback }, ...old])
    tone(result.correct)
    if (result.discoveredAttack) setOpenAttack(packet)
  }
  function nextPacket() {
    if (!resolved || finished || paused || modalOpen) return
    if (index + 1 >= TOTAL) { setComplete(true); return }
    const nextIndex = index + 1
    setIndex(nextIndex); setResolved(false); setRoute(null); decisionLock.current = false
    if (nextIndex === 5) {
      setGame(g => ({ ...g, idpsEnabled: false })); setNotice('Учебное обслуживание: модуль IDPS выключен. Восстановите защиту перед полной проверкой.')
    } else if (nextIndex === 15) {
      setGame(g => ({ ...g, idpsProfileAttached: false })); setNotice('Правило изменено: профиль СОВ снят. Модуль работает, но трафик не поступает на инспекцию — назначьте профиль правилу.')
    } else setNotice('')
  }
  function restart() {
    setScenarios(createScenarioSession())
    setGame(createGameState()); setIndex(0); setRoute(null); setResolved(false); setPaused(false); setSeconds(0); setEvents([]); setComplete(false); setOpenAttack(null); setRestartConfirm(false); setNotice(''); setPage('simulator'); decisionLock.current = false
  }
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (modalOpen || page !== 'simulator' || paused || finished || event.repeat || event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test((event.target as HTMLElement).tagName)) return
      if (event.key === '1' && !resolved) setRoute('fast')
      if (event.key === '2' && !resolved) setRoute('full')
      if (event.key.toLowerCase() === 'a' || event.key.toLowerCase() === 'ф') decide('allow')
      if (event.key.toLowerCase() === 'b' || event.key.toLowerCase() === 'и') decide('block')
      if (event.key === 'Enter' && resolved) { event.preventDefault(); nextPacket() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#simulator" aria-label="UserGate — симулятор" onClick={e => { e.preventDefault(); setPage('simulator') }}><img className="official-logo" src={`data:image/svg+xml,${encodeURIComponent(usergateLogo)}`} alt="UserGate" /></a>
      <div className="sidebar-caption">CYBERSECURITY LAB</div>
      <div className="sidebar-divider"/>
      <div className="nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Основная навигация">
        <button aria-label="Симулятор" title="Симулятор" className={`nav-item ${page === 'simulator' ? 'active' : ''}`} onClick={() => setPage('simulator')}><Activity size={19}/><span>Симулятор</span><ChevronRight size={15}/></button>
        <button aria-label="Коллекция угроз" title="Коллекция угроз" className={`nav-item ${page === 'collection' ? 'active' : ''}`} onClick={() => setPage('collection')}><Layers3 size={19}/><span>Коллекция угроз</span><span className="nav-count">{unlocked.length}</span></button>
        <button aria-label="Журнал событий" title="Журнал событий" className={`nav-item ${page === 'journal' ? 'active' : ''}`} onClick={() => setPage('journal')}><FileText size={19}/><span>Журнал событий</span>{events.length > 0 && <span className="nav-event-dot"/>}</button>
      </nav>
      <div className="sidebar-lab"><div className="lab-icon"><Crosshair size={19}/></div><div><strong>NGFW Simulator</strong><span>Учись. Анализируй. Защищай.</span></div><span className="beta-tag">LAB</span></div>
      <div className="sidebar-bottom"><div className="help-card"><BookOpen size={21}/><h4>На страже сети</h4><p>Каждый пакет — решение.<br/>Разберитесь, как защитить<br/>свой периметр.</p><button onClick={() => setHelp(true)}>Как играть <ArrowUpRight size={16}/></button></div><a className="documentation" href="https://docs.usergate.com/" target="_blank" rel="noreferrer"><BookOpen size={15}/>Документация UserGate<ExternalLink size={13}/></a><div className="sidebar-foot"><span className="status-dot"/>Учебная модель<span>v1.0</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><span>Учебный центр</span><ChevronRight size={14}/><strong>NGFW Simulator</strong></div><div className="topbar-right"><span className="environment"><span className="status-dot"/>Локальная симуляция</span><span className="topbar-divider"/><button className="icon-button" onClick={() => setHelp(true)} aria-label="Как играть"><CircleHelp size={20}/></button><span className="avatar">OP</span></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow"><span/>ИНТЕРАКТИВНАЯ ЛАБОРАТОРИЯ</div><h1>{page === 'simulator' ? <>Трафик под контролем<span className="orange-text">.</span></> : page === 'collection' ? <>Коллекция угроз<span className="orange-text">.</span></> : <>Журнал событий<span className="orange-text">.</span></>}</h1><p>{page === 'simulator' ? 'Вы — оператор NGFW. Анализируйте пакеты. Останавливайте угрозы. Защищайте сеть.' : page === 'collection' ? 'Распознавайте атаки и собирайте знания о том, как им противостоять.' : 'Каждое решение оставляет след. Изучайте результаты и совершенствуйте защиту.'}</p></div><button className="outline-button guide-button" onClick={() => setHelp(true)}><BookOpen size={16}/>Как играть<ArrowUpRight size={14}/></button></div>

        <div className="stats-grid">
          <div className="stat-card"><div className="stat-label"><span>Обработано пакетов</span><Network size={17}/></div><div className="stat-value">{game.processed.toString().padStart(2, '0')}<span>/ {TOTAL}</span></div><div className="stat-detail"><span className="tiny-bar"><i style={{width: `${game.processed / TOTAL * 100}%`}}/></span>Текущая смена</div></div>
          <div className="stat-card"><div className="stat-label"><span>Точность решений</span><Crosshair size={17}/></div><div className="stat-value">{game.processed ? accuracy : '—'}<span>%</span></div><div className="stat-detail green-text"><span className="tiny-dot"/>{game.processed ? `${game.correct} верных решений` : 'Всё начинается с первого пакета'}</div></div>
          <div className={`stat-card ${game.missedAttacks >= 7 ? 'danger-stat' : ''}`}><div className="stat-label"><span>Пропущено атак</span><ShieldAlert size={17}/></div><div className="stat-value">{game.missedAttacks.toString().padStart(2, '0')}<span>/ 10</span></div><div className="stat-detail"><div className="lives" aria-label={`Пропущено ${game.missedAttacks} из 10 атак`}>{Array.from({length: 10}, (_, i) => <i key={i} className={i < game.missedAttacks ? 'lost' : ''}/>)}</div><span>Лимит смены</span></div></div>
          <div className="stat-card score-card"><div className="stat-label"><span>Ваши очки</span><Trophy size={17}/></div><div className="stat-value">{game.score.toLocaleString('ru-RU')}<span className="xp-label">XP</span>{game.streak >= 2 && <span className="streak"><Zap size={11}/>{game.streak} подряд</span>}</div><div className="stat-detail"><Trophy size={11}/>Рекорд: {record.toLocaleString('ru-RU')} XP</div></div>
        </div>

        {page === 'simulator' && <>
          <div className="shift-bar"><div><span className="shift-tag">СМЕНА 01</span><span className="shift-name">Первая линия обороны</span><span className="difficulty"><i/><i/><i/>Базовый уровень</span></div><div><span className="timer"><Clock3 size={14}/>{clock(seconds)}</span><button className="text-button" onClick={() => setPaused(!paused)} disabled={finished}>{paused ? <Play size={14}/> : <Pause size={14}/>} {paused ? 'Продолжить' : 'Пауза'}</button><button className="icon-button" onClick={() => setRestartConfirm(true)} aria-label="Начать заново"><RotateCcw size={15}/></button></div></div>
          <NetworkMap route={route} enabled={game.idpsEnabled} profileAttached={game.idpsProfileAttached} onProfileToggle={() => { if (!resolved && !finished) { setGame(g => ({...g, idpsProfileAttached: !g.idpsProfileAttached})); setNotice('') } }} paused={paused || finished || modalOpen} locked={resolved || finished} onToggle={() => { if (!resolved && !finished) { setGame(g => ({...g, idpsEnabled: !g.idpsEnabled})); setNotice('') } }}/>
          {notice && !finished && <div className="system-notice" role="alert"><ShieldAlert size={18}/><span>{notice}</span><button className="text-button" onClick={() => {setGame(g => ({...g, idpsEnabled: true, idpsProfileAttached: true})); setNotice('')}} disabled={paused || resolved}>{game.idpsProfileAttached ? 'Активировать IDPS' : 'Назначить профиль СОВ'} <ArrowRight size={14}/></button></div>}
          {finished ? <section className="finish-panel panel"><div className={`finish-icon ${game.gameOver ? 'failed' : ''}`}>{game.gameOver ? <ShieldOff size={35}/> : <Trophy size={35}/>}</div><div className="eyebrow orange">{game.gameOver ? 'ЛИМИТ ПРОПУЩЕННЫХ АТАК' : 'СМЕНА ЗАВЕРШЕНА'}</div><h2>{game.gameOver ? 'Периметр скомпрометирован' : 'Хорошая работа, оператор!'}</h2><p>{game.gameOver ? '10 атак достигли сети. Изучите журнал решений и попробуйте защитить периметр снова.' : `Вы обработали ${TOTAL} пакета и открыли ${unlocked.length} досье угроз. Каждая смена делает вашу защиту сильнее.`}</p><div className="finish-stats"><span><strong>{game.score}</strong>очков опыта</span><span><strong>{accuracy}%</strong>точность</span><span><strong>{game.bestStreak}</strong>лучшая серия</span></div><div className="finish-buttons"><button className="primary-button" onClick={restart}><RotateCcw size={16}/>Новая смена</button><button className="outline-button" onClick={() => setPage('journal')}><FileText size={16}/>Разбор решений</button></div></section> : <div className="workstation">
            {paused && <div className="pause-overlay"><div className="pause-icon"><Pause size={27}/></div><h2>Смена на паузе</h2><p>Пакеты подождут. Продолжите, когда будете готовы.</p><button className="primary-button" onClick={() => setPaused(false)}><Play size={16}/>Продолжить смену</button></div>}
            <section className="packet-panel panel">
              <div className="panel-heading"><div><div className="orange-icon"><Radio size={17}/></div><h3>Входящий пакет</h3><span className="packet-number">#{String(index + 1).padStart(4, '0')}</span></div><Tag color={resolved ? 'neutral-tag' : 'amber-tag'}>{resolved ? 'Обработан' : 'Ожидает решения'}</Tag></div>
              <div className="packet-content">
                <div className="packet-app"><div className="app-icon">{packet.protocol.includes('DNS') ? <Globe2 size={23}/> : packet.port === 443 ? <LockKeyhole size={22}/> : <Network size={24}/>}</div><div><h2>{packet.app}</h2><span>{packet.protocol} <span className="small-dot">·</span> Порт {packet.port}</span></div><Tag>{packet.size}</Tag></div>
                <div className="address-flow"><div><label>ИСТОЧНИК</label><strong>{packet.source}</strong><span>Узел-источник</span></div><span className="address-arrow"><ArrowRight size={20}/></span><div><label>НАЗНАЧЕНИЕ</label><strong>{packet.destination}</strong><span>Узел назначения</span></div></div>
                <div className="evidence-header"><span><Terminal size={14}/>ДАННЫЕ СЕАНСА</span><span>READ ONLY</span></div>
                <div className="terminal"><div className="terminal-line"><span>01</span><code><em>application</em> <b>{packet.app}</b></code></div><div className="terminal-line"><span>02</span><code><em>transport</em> {packet.protocol} <i>→</i> dst.port {packet.port}</code></div>{packet.indicators.map((indicator, i) => <div className="terminal-line" key={i}><span>{String(i + 3).padStart(2, '0')}</span><code>{indicator}</code></div>)}</div>
                {route === 'full' && game.idpsEnabled && game.idpsProfileAttached && <div className="inspection"><h4><Search size={14}/>Результат глубокой проверки</h4>{packet.inspection.map((line, i) => <p key={i}><span/>{line}</p>)}</div>}
                {route === 'full' && (!game.idpsEnabled || !game.idpsProfileAttached) && <div className="inspection inspection-error"><ShieldOff size={17}/><p>{!game.idpsEnabled ? 'IDPS отключён. Результаты проверки недоступны. Включите модуль.' : 'Модуль работает, но профиль СОВ не назначен правилу. Подключите профиль, чтобы инспектировать трафик.'}</p></div>}
                {route === 'fast' && <div className="route-hint"><Zap size={15}/><span>Ускоренная обработка без повторной глубокой проверки. Сеанс должен быть проверен, без фрагментации и требований СОВ/L7.</span></div>}
                <div className="packet-bottom"><span className="status-dot"/>Синтетический трафик<span>Сеанс UG-{String(index + 1048)}</span></div>
              </div>
            </section>
            <section className="decision-panel panel"><div className="panel-heading"><div><Crosshair size={17}/><h3>Ваше решение</h3></div><Tag>ОПЕРАТОР</Tag></div><div className="decision-content">
              <div className="step-heading"><span>1</span><h4>Выберите путь обработки</h4></div><p className="step-description">Достаточно быстрой проверки или нужен IDPS?</p>
              <div className="route-options" role="group" aria-label="Путь обработки"><button className={`route-option ${route === 'fast' ? 'chosen' : ''}`} onClick={() => setRoute('fast')} disabled={resolved || paused}><span className="route-choice-icon"><Zap size={21}/></span><div><strong>FastPath</strong><span>Проверенный сеанс</span></div><span className="choice-circle">{route === 'fast' && <span/>}</span><kbd>1</kbd></button><button className={`route-option ${route === 'full' ? 'chosen' : ''}`} onClick={() => setRoute('full')} disabled={resolved || paused}><span className="route-choice-icon"><ShieldCheck size={21}/></span><div><strong>Полная проверка</strong><span>Глубокая проверка</span></div><span className="choice-circle">{route === 'full' && <span/>}</span><kbd>2</kbd></button></div>
              <div className="step-divider"/><div className="step-heading"><span>2</span><h4>Определите характер трафика</h4></div><p className="step-description">Изучите признаки и примите решение о пакете.</p>
              <div className="verdict-buttons"><button className="allow-button" onClick={() => decide('allow')} disabled={!route || resolved || paused}><Check size={20}/><span>Разрешить<small>Нормальный трафик</small></span><kbd>A</kbd></button><button className="block-button" onClick={() => decide('block')} disabled={!route || resolved || paused}><ShieldAlert size={19}/><span>Заблокировать<small>Вредоносный трафик</small></span><kbd>B</kbd></button></div>
              {!resolved ? <div className="decision-tip"><CircleHelp size={16}/><p>{!route ? 'Сначала выберите путь обработки, затем разрешите или заблокируйте пакет.' : 'За верный путь и решение — 100 XP. Ошибочная блокировка тоже снижает счёт.'}</p></div> : <div className={`decision-result ${game.lastResult?.correct ? 'success-result' : 'error-result'}`} role="status"><div>{game.lastResult?.correct ? <CheckCheck size={20}/> : <ShieldAlert size={20}/>}<strong>{game.lastResult?.correct ? 'Верное решение!' : 'Есть над чем поработать'}</strong><span>{game.lastResult!.scoreDelta > 0 ? '+' : ''}{game.lastResult!.scoreDelta} XP</span></div><p>{game.lastResult?.feedback}</p>{game.lastResult?.discoveredAttack && <button className="text-button" onClick={() => setOpenAttack(packet)}><BookOpen size={14}/>Открыть досье угрозы<ArrowUpRight size={14}/></button>}<button className="primary-button full-width" onClick={nextPacket} disabled={paused}>{index + 1 === TOTAL ? 'Завершить смену' : 'Следующий пакет'}<ArrowRight size={16}/></button></div>}
              <div className="decision-foot"><LockKeyhole size={13}/>Реальная сеть в безопасности. Это симуляция.</div>
            </div></section>
          </div>}
          <div className="bottom-tip"><span className="tip-icon"><Sparkles size={17}/></span><p><strong>Маленькие решения. Большая защита.</strong> Правильно распознанные атаки открывают карточки в вашей коллекции угроз.</p><button onClick={() => setPage('collection')}>В коллекцию<ArrowRight size={16}/></button></div>
        </>}

        {page === 'collection' && <section className="collection-section"><div className="section-toolbar"><div><h2>База знаний оператора <span>{unlocked.length} / {attackScenarios.length}</span></h2><p>Досье открывается за верный путь обработки и блокировку атаки.</p></div><label className="search-box"><Search size={16}/><input placeholder="Название или CVE" value={search} onChange={e => setSearch(e.target.value)} aria-label="Поиск угроз"/></label></div><div className="collection-grid">{attackScenarios.filter(s => !search || game.discoveredIds.includes(s.id) && `${s.attack!.name} ${s.attack!.cve || ''}`.toLowerCase().includes(search.toLowerCase())).map((s, i) => { const available = game.discoveredIds.includes(s.id); return <button key={s.id} className={`collection-card ${available ? 'unlocked' : 'locked'}`} disabled={!available} onClick={() => setOpenAttack(s)}><div className="collection-card-top"><span className="collection-card-icon">{available ? <ShieldAlert size={23}/> : <LockKeyhole size={22}/>}</span><span>ДОСЬЕ {String(i + 1).padStart(2, '0')}</span>{available && <ArrowUpRight size={18}/>}</div><h3>{available ? s.attack!.name : 'Неизвестная угроза'}</h3><Tag color={available ? 'orange-tag' : ''}>{available ? s.attack!.cve || 'Сетевая атака' : 'ЕЩЁ НЕ ОБНАРУЖЕНА'}</Tag><p>{available ? s.attack!.description : 'Распознайте и остановите атаку, чтобы открыть это досье.'}</p><div className="collection-card-footer">{available ? <><Check size={14}/>Изучить угрозу</> : <><LockKeyhole size={13}/>Откроется во время смены</>}</div></button> })}</div>{search && !unlocked.some(s => `${s.attack!.name} ${s.attack!.cve || ''}`.toLowerCase().includes(search.toLowerCase())) && <div className="empty-state"><Search size={32}/><h3>Ничего не найдено</h3><p>Поиск доступен по открытым досье.</p></div>}</section>}

        {page === 'journal' && <section className="panel journal-panel"><div className="panel-heading"><div><FileText size={18}/><h3>История решений</h3><Tag>{events.length}</Tag></div><span className="muted">Текущая смена</span></div>{events.length ? <div className="journal-list">{events.map(event => <article className="journal-entry" key={event.id}><span className={`event-icon ${event.correct ? 'positive' : 'negative'}`}>{event.correct ? <Check size={18}/> : <ShieldAlert size={18}/>}</span><div><div className="journal-entry-title"><strong>#{String(event.id).padStart(4, '0')} · {event.app}</strong><span>{event.time}</span></div><p>{event.message}</p><div className="event-tags"><Tag>{event.route === 'fast' ? 'FastPath' : 'Полная проверка'}</Tag><Tag color={event.verdict === 'block' ? 'orange-tag' : 'green-tag'}>{event.verdict === 'block' ? 'Заблокирован' : 'Разрешён'}</Tag></div></div></article>)}</div> : <div className="empty-state"><FileText size={34}/><h3>Ваша смена только начинается</h3><p>Примите решение по первому пакету — оно появится здесь.</p><button className="primary-button" onClick={() => setPage('simulator')}>К симулятору<ArrowRight size={16}/></button></div>}</section>}
        <footer className="main-footer"><span>USERGATE <b>×</b> CYBERSECURITY LAB <i>Неофициальная учебная игра</i></span><div><button onClick={() => setSound(!sound)} aria-label={sound ? 'Выключить звук' : 'Включить звук'}>{sound ? <Volume2 size={14}/> : <VolumeX size={14}/>}Звук {sound ? 'вкл.' : 'выкл.'}</button><span>Все пакеты вымышлены</span></div></footer>
      </main>
    </div>
    {help && <Modal title="Как играть" onClose={() => setHelp(false)} wide><div className="discovery-icon"><BookOpen size={28}/></div><div className="eyebrow orange">ИНСТРУКТАЖ ОПЕРАТОРА</div><h2>Каждый пакет — ваше решение.</h2><p className="modal-description">За смену нужно обработать {TOTAL} пакета. Каждая новая смена меняет порядок и параметры заданий. Читайте признаки: одинаковое приложение может требовать другого пути. На десятой пропущенной атаке смена заканчивается досрочно.</p><div className="help-steps"><div><span>01</span><section><h4>Контролируйте IDPS</h4><p>Держите СОВ (IDPS) активной и назначьте профиль СОВ разрешающему правилу. Учебные события могут отключить модуль или снять профиль — восстановите оба условия.</p></section></div><div><span>02</span><section><h4>Выбирайте путь</h4><p><b>FastPath</b> — проверенный сеанс, не требующий СОВ/L7-инспекции, без фрагментации. <b>Полная проверка</b> — новый, изменившийся или фрагментированный поток либо трафик, которому назначена СОВ: изучите результат проверки IDPS.</p></section></div><div><span>03</span><section><h4>Разрешайте или блокируйте</h4><p>Нормальный трафик должен пройти, вредоносный — быть остановлен. Верное решение и путь дают 100 XP и открывают досье атаки.</p></section></div></div><div className="help-scoring"><span><b>−100 XP</b>пропуск атаки</span><span><b>−40 XP</b>ложная блокировка</span><span><b>−25 XP</b>ошибка обработки</span></div><p className="help-disclaimer">Это упрощённая учебная модель, не интерфейс реального UserGate NGFW. Профиль СОВ назначается разрешающему правилу; модуль без профиля трафик не проверяет. События обслуживания в игре условные. В документации UserGate ускоренный путь называется FastPath. «Полная проверка» — наше учебное обозначение обычного пути: Ingress → Policy processing → Egress. Пакеты, требующие СОВ/L7-инспекции, и фрагментированные пакеты не допускаются в FastPath. Шифрованный трафик в сценариях с глубокой проверкой уже расшифрован учебным шлюзом. В игре блокировка — ручное отбрасывание пакета. В реальном профиле СОВ действие сигнатуры и журналирование настраиваются отдельно. Блокировка всегда останавливает пакет; ошибка пути влияет на очки. Прогресс смены хранится до перезагрузки страницы, рекорд — в этом браузере.</p><a className="source-link" href="https://docs.usergate.com/usergate-ngfw-7-packet-flow_1569.html" target="_blank" rel="noreferrer">UserGate NGFW: Packet Flow<ExternalLink size={14}/></a><a className="source-link second-source" href="https://docs.usergate.com/sistema-obnaruzheniya-i-predotvrasheniya-vtorzhenij_912.html" target="_blank" rel="noreferrer">Настройка СОВ<ExternalLink size={14}/></a><button className="primary-button full-width" onClick={() => setHelp(false)}>Приступить к работе<ArrowRight size={16}/></button></Modal>}
    {openAttack && <AttackCard packet={openAttack} onClose={() => setOpenAttack(null)}/>}
    {restartConfirm && <Modal title="Новая смена" onClose={() => setRestartConfirm(false)}><div className="discovery-icon"><RotateCcw size={28}/></div><h2>Начать новую смену?</h2><p className="modal-description">Очки, журнал и открытые досье текущей смены будут сброшены. Ваш рекорд сохранится.</p><div className="finish-buttons"><button className="outline-button" onClick={() => setRestartConfirm(false)}>Продолжить текущую</button><button className="primary-button" onClick={restart}>Начать заново</button></div></Modal>}
  </div>
}
