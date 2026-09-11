/* ══════════════════════════════════════════════════════════════
   AI 검토 서버 함수  (Vercel /api/review)

   환경변수
     GEMINI_API_KEY  필수. 구글 AI Studio에서 발급한 키
     INVITE_CODES    필수. 참여 코드를 쉼표로 구분. 예) kim-01,park-02,lee-03
     GEMINI_MODEL    선택. 기본값 gemini-flash-latest
     ALLOW_ORIGIN    선택. 허용할 출처. 비우면 모든 출처 허용

   이 파일 하나만 고치면 프롬프트가 바뀝니다. 화면 파일은 건드리지 않아도 됩니다.
   ══════════════════════════════════════════════════════════════ */

const MAX_DRAFT = 4000;
const MAX_CONTEXT = 8000;

/* ── 공통 지침 ────────────────────────────────────────────── */
const AI_SYS = [
  '당신은 특수학교 교사가 쓴 「AI·디지털 도구 활용 차시 교수·학습 설계안」의 문장을 다듬는 편집자다. 저자가 아니다.',
  '',
  '지켜야 할 원칙',
  '- 교사가 쓴 내용을 넘어서는 사실, 활동, 도구, 학생 정보를 새로 지어내지 않는다. 비어 있으면 비어 있다고 둔다.',
  '- 2022 개정 교육과정의 학생 참여중심 수업과 보편적 학습설계(UDL)를 전제로 한다.',
  '- 문체는 개조식이다. 명사형이나 "~한다"로 끝내고 경어체를 쓰지 않는다. 한 문장에 한 가지만 담는다.',
  '- "흥미를 갖고 적극적으로", "효과적으로", "다양한 활동을 통해" 같은 속 빈 수식을 쓰지 않는다.',
  '- 학생을 낮춰 부르는 표현(장애아, 저수준 학생, 못하는 아이)을 쓰지 않는다. 장애 유형은 지적장애·자폐성장애 같은 공식 표기를 쓴다.',
  '- 관찰할 수 있는 동작과 조건으로 쓴다. 성취기준 코드는 새로 만들지 않는다.',
  '',
  '출력은 JSON만 낸다. 설명, 머리말, 코드펜스를 붙이지 않는다.'
].join('\n');

/* ── 문항별 판정 기준과 예시 ──────────────────────────────── */
const AIDATA = {
  target:{n:'대상', lim:'한 줄 30자 안쪽',
    crit:['인원과 학년이 드러나는가','이 수업에서 학생 사이가 갈리는 지점이 한 가지 이상 있는가'],
    good:['고등부 1학년 6명(지적장애). 글 읽기 수준 편차 큼',
          '고2 4명(지적장애 2, 자폐성장애 2). 소근육 사용에서 차이 큼'],
    bad:[['고등학교 1학년 학생들','인원과 특성이 없어 뒤의 수준별 목표가 근거를 잃음'],
         ['수준이 낮은 아이들 6명','학생을 낮춰 부르는 표현']]},

  analysis:{n:'학생 및 과제 분석', lim:'한 줄 32자 안쪽',
    crit:['이미 할 수 있는 것이 있는가','무엇에서 수준이 갈리는지 있는가','그래서 과제를 몇 단계로 나눴는지 있는가'],
    good:['전원·시작 버튼 조작은 전원 가능. 세제량 판단에서 갈림. 조작을 4단계로 분절',
          '도구 이름 말하기는 가능. 순서 기억에서 갈림. 그림 순서표로 3단계 제시'],
    bad:[['학생들의 수준이 다양하다','무엇에서 갈리는지가 없어 과제 분석으로 이어지지 않음'],
         ['세탁기에 관심이 많다','관심만 있고 선행 지식과 과제 분석이 없음']]},

  topic:{n:'수업 주제', lim:'한 줄 30자 안쪽',
    crit:['한 시간에 학생이 하는 일이 드러나는가','단원명을 그대로 옮긴 것은 아닌가'],
    good:['세탁기 조작 순서를 익혀 빨래 한 번 완수하기','작업복 얼룩을 종류별로 구분해 애벌 처리하기'],
    bad:[['제조 관련 직종 알아보기','단원명 수준이라 한 차시에 학생이 하는 일이 없음'],
         ['세탁기에 대해 이해한다','관찰할 수 없는 동사']]},

  standard:{n:'성취기준', lim:'한 줄 32자 안쪽',
    crit:['코드와 문장이 함께 있는가','이 차시가 실제로 도달하려는 하나인가'],
    good:['[12진로03-02] 생활 속 기기를 순서에 따라 조작한다'],
    bad:[['여러 성취기준을 두루 다룸','어느 것에 도달하려는지 정해지지 않음']]},

  goal0:{n:'학습목표 가(스스로 하는 수준)', lim:'한 줄',
    crit:['도움 없이 해내는 조건인가','관찰할 수 있는 동작인가','"~한다"로 끝나는가'],
    good:['세탁 코스를 스스로 골라 빨래를 끝낸다'],
    bad:[['세탁기를 잘 사용할 수 있다','"잘"은 확인할 기준이 없음']]},

  goal1:{n:'학습목표 나(단서를 주면 하는 수준)', lim:'한 줄',
    crit:['주는 단서가 무엇인지 밝혔는가','가와 도움의 종류가 다른가'],
    good:['그림 순서표를 보고 세탁기를 순서대로 조작한다'],
    bad:[['조금 도와주면 세탁기를 사용한다','도움의 종류가 무엇인지 없어 가와 길이만 다름']]},

  goal2:{n:'학습목표 다(함께 참여하는 수준)', lim:'한 줄',
    crit:['교사와 함께 하는 행동이 있는가','태도 서술이 아니라 참여 행동인가'],
    good:['교사와 함께 시작 버튼을 누르고 완료음을 확인한다'],
    bad:[['세탁기 사용에 관심을 갖는다','참여 행동이 아니라 태도라 확인할 수 없음']]},

  intent:{n:'수업 의도', lim:'한 줄 30자 안쪽',
    crit:['교과 측면의 이유가 있는가','학생 측면의 이유가 있는가','활동 소개가 아니라 이유인가'],
    good:['교과: 가정 자립 기능 중 반복 빈도가 가장 높아 먼저 다룸. 학생: 실패가 누적된 과제라 성공 경험이 먼저 필요'],
    bad:[['학생들이 즐겁게 참여하도록 설계함','어느 수업에나 해당해 이 차시의 판단이 드러나지 않음'],
         ['먼저 영상을 보고 실습한다','활동 순서 소개일 뿐 이유가 없음']]},

  tools:{n:'AI·디지털 도구', lim:'한 줄 80자 안쪽',
    crit:['도구가 하나로 특정되는가','고른 이유가 수업 의도와 이어지는가'],
    good:['세탁기 조작 시뮬레이션 웹앱 — 실물이 1대라 6명이 반복할 수 없어, 실패 부담 없는 반복 환경이 필요'],
    bad:[['패들렛, 캔바, 챗GPT 등 다양한 도구 활용','나열만 있고 이유가 없으며 한 차시에 실제로 쓰기 어려움'],
         ['흥미 유발을 위해 영상 활용','흥미 유발은 이유가 아니라 기대']]},

  ai0:{n:'AI 구상 ① 무엇을 개발하는가', lim:'칸 한 개 분량',
    crit:['자료의 형태가 있는가','학생이 그것으로 하는 행동이 있는가'],
    good:['세탁기 조작 시뮬레이션 웹앱. 코스 선택과 세제량 투입만 반복하도록 화면을 줄임'],
    bad:[['AI를 활용한 자료를 만든다','형태도 학생 행동도 없음']]},

  ai1:{n:'AI 구상 ② 왜 개발이 필요한가', lim:'칸 한 개 분량',
    crit:['기존 방식의 한계가 우리 반 조건으로 구체적인가','기성 도구로는 안 되는 이유인가'],
    good:['실물 세탁기가 1대뿐이라 6명이 순서를 반복할 수 없고, 잘못 누르면 되돌릴 수 없어 시도 자체를 피함'],
    bad:[['학생들의 흥미를 높이기 위해 필요하다','기성 도구로도 되는 이유라 직접 제작의 근거가 못 됨']]},

  ai2:{n:'AI 구상 ③ 기대 효과', lim:'칸 한 개 분량',
    crit:['학습 면과 운영 면이 나뉘어 있는가','확인할 수 있는 변화인가'],
    good:['학습: 실패 부담 없이 순서를 익힌 뒤 실물 조작으로 옮겨감. 운영: 조작 기록이 남아 개별 피드백 근거가 됨'],
    bad:[['학습 효과가 향상될 것으로 기대된다','무엇이 어떻게 달라지는지 확인할 수 없음']]},

  title:{n:'활동제목', lim:'15자 안쪽',
    crit:['학생에게 그대로 말해 줄 수 있는 이름인가'],
    good:['오늘의 빨랫감','세제는 얼마나?'],
    bad:[['동기 유발 및 학습 목표 확인','교사용 절차 명칭이라 학생에게 말할 수 없음']]},

  tAct:{n:'교사가 하는 일', lim:'한 줄 19자, 여러 줄 가능',
    crit:['교사의 구체적 행동인가','한 줄에 한 가지만 담았는가'],
    good:['실제 빨랫감을 꺼내 보여 준다','세제 계량컵의 눈금을 손가락으로 짚어 준다'],
    bad:[['학생들이 이해할 수 있도록 지도한다','무엇을 하는지가 없음']]},

  sAct:{n:'학생이 하는 일', lim:'한 줄 19자, 여러 줄 가능',
    crit:['학생이 실제로 하는 동작이나 말인가'],
    good:['만져 보고 어떤 옷인지 말한다','계량컵에 세제를 눈금까지 붓는다'],
    bad:[['교사의 설명을 주의 깊게 듣는다','확인할 수 없는 수동적 서술']]},

  tool:{n:'도구', lim:'19자 안쪽',
    crit:['도구가 하나로 특정되는가','쓰지 않기로 했다면 미사용이라고 적었는가'],
    good:['세탁기 시뮬레이션 웹앱','미사용'],
    bad:[['각종 에듀테크 도구','무엇인지 특정되지 않음']]},

  role:{n:'역할', lim:'19자 안쪽, 두 줄까지',
    crit:['그 단계에서 도구가 대신하거나 돕는 일이 구체적인가','미사용이면 쓰지 않는 이유가 있는가'],
    good:['잘못 누른 순서를 즉시 되돌려 다시 시도하게 함','미사용 — 실물의 무게와 소리를 먼저 경험하게 하려고'],
    bad:[['학습을 돕는다','어느 도구에나 해당해 역할이 드러나지 않음']]}
};

function buildPrompt(field, draft, context){
  const d = AIDATA[field];
  const L = [AI_SYS, '', '## 지금 다루는 칸', d.n + ' (' + d.lim + ')'];
  L.push('', '## 판정 기준', d.crit.map((c, i) => (i + 1) + '. ' + c).join('\n'));
  L.push('', '## 좋은 예', d.good.map(x => '- ' + x).join('\n'));
  L.push('', '## 나쁜 예와 그 이유', d.bad.map(x => '- ' + x[0] + '  → ' + x[1]).join('\n'));
  L.push('', '## 같은 설계안의 다른 칸 (맥락. 비어 있으면 아직 안 쓴 것)', context || '{}');
  L.push('', '## 교사가 쓴 초안', draft, '',
    '## 할 일',
    '초안의 내용은 그대로 두고 어법, 분량, 용어, 문체만 판정 기준에 맞게 고쳐라.',
    '초안에 없는 활동·도구·학생 정보를 새로 넣지 마라. 분량 기준을 넘기지 마라.',
    '출력: {"result":"고친 문장","notes":["무엇을 왜 고쳤는지 한 줄", "..."]}');
  return L.join('\n');
}

module.exports = async (req, res) => {
  const allow = process.env.ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'POST로만 받습니다.'});

  const codes = (process.env.INVITE_CODES || '').split(',').map(c => c.trim()).filter(Boolean);
  if (!process.env.GEMINI_API_KEY)
    return res.status(500).json({error: '서버에 GEMINI_API_KEY가 설정되지 않았습니다.'});
  if (!codes.length)
    return res.status(500).json({error: '서버에 INVITE_CODES가 설정되지 않았습니다. 참여 코드를 먼저 등록해 주세요.'});

  let body = req.body;
  if (typeof body === 'string'){ try { body = JSON.parse(body); } catch(_){ body = {}; } }
  body = body || {};

  if (!codes.includes(String(body.code || '').trim()))
    return res.status(403).json({error: '참여 코드가 맞지 않습니다. 연구회에서 받은 코드를 확인해 주세요.'});

  if (body.mode === 'ping') return res.status(200).json({ok: true});

  if (body.mode !== 'polish')
    return res.status(400).json({error: '지원하지 않는 요청입니다.'});
  if (!AIDATA[body.field])
    return res.status(400).json({error: '알 수 없는 항목입니다.'});

  const draft = String(body.draft || '').trim();
  const context = String(body.context || '').slice(0, MAX_CONTEXT);
  if (!draft) return res.status(400).json({error: '초안이 비어 있습니다.'});
  if (draft.length > MAX_DRAFT) return res.status(413).json({error: '초안이 너무 깁니다.'});

  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY},
        body: JSON.stringify({
          contents: [{role: 'user', parts: [{text: buildPrompt(body.field, draft, context)}]}],
          generationConfig: {temperature: 0.25, maxOutputTokens: 900, responseMimeType: 'application/json'}
        })
      }
    );
    const d = await r.json().catch(() => null);
    if (!r.ok){
      const msg = (d && d.error && d.error.message) || ('AI 호출 실패 (HTTP ' + r.status + ')');
      return res.status(r.status === 429 ? 429 : 502)
        .json({error: r.status === 429 ? '지금 요청이 몰려 있습니다. 잠시 뒤 다시 눌러 주세요.' : msg});
    }
    const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
    const text = parts.map(p => p.text || '').join('').trim();
    if (!text) return res.status(502).json({error: '빈 응답이 돌아왔습니다.'});
    let out;
    try { out = JSON.parse(text.replace(/^```json|^```|```$/g, '').trim()); }
    catch(_){ out = {result: text}; }
    return res.status(200).json(out);
  } catch (err){
    return res.status(502).json({error: '서버에서 AI를 부르지 못했습니다: ' + err.message});
  }
};
