/* ══════════════════════════════════════════════════════════════
   AI 검토 서버 함수  (Vercel /api/review)

   환경변수
     GEMINI_API_KEY  필수. 구글 AI Studio에서 발급한 키
     INVITE_CODES    선택. 비워 두면 누구나 사용. 값을 넣으면 그 코드를 가진 사람만 사용
                     예) kim-01,park-02,lee-03
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
  target:{n:'학생 현황', lim:'한 줄. 학급과 인원만',
    crit:['학급이 드러나는가(과정과 학년-반)','실제 수업에 들어오는 인원이 있는가','장애 유형이나 수준 차이를 여기 적지는 않았는가'],
    good:['고등부 1-2 / 7명',
          '중학부 3-1 / 5명'],
    bad:[['고등학교 1학년 학생들','학급과 인원이 없음'],
         ['고등부 1-2 / 7명(지적장애, 읽기 편차 큼)','특성은 학생 및 과제 분석 칸에 써야 함']]},

  analysis:{n:'학생 및 과제 분석', lim:'두세 줄. 수준별로 줄을 나눠 써도 됨',
    crit:['학생 특성(장애 유형 등)이 있는가','이미 할 수 있는 것이 있는가','무엇에서 수준이 갈리는지 있는가','그래서 과제를 몇 단계로 나눴는지 있는가'],
    good:['지적장애 5명, 자폐성장애 2명. 직업 이름 말하기는 전원 가능. 미래를 시간 순으로 떠올리는 데서 갈림. 계획서를 3단계로 분절',
          '가 수준: 원하는 직업과 준비 과정을 스스로 연결해 씀\n나 수준: 보기 카드를 주면 골라 씀\n다 수준: 교사와 함께 이미지를 보며 한 문장으로 말함'],
    bad:[['학생들의 수준이 다양하다','무엇에서 갈리는지가 없어 과제 분석으로 이어지지 않음'],
         ['직업에 관심이 많다','관심만 있고 선행 지식과 과제 분석이 없음']]},

  topic:{n:'수업 주제', lim:'한 줄',
    crit:['한 시간에 학생이 하는 일이 드러나는가','단원명을 그대로 옮긴 것은 아닌가'],
    good:['미래의 나의 직업 모습을 상상하고 실천 계획서 작성하기',
          '세탁기 조작 순서를 익혀 빨래 한 번 완수하기'],
    bad:[['미래 사회와 직업 알아보기','단원명 수준이라 한 차시에 학생이 하는 일이 없음'],
         ['나의 미래에 대해 이해한다','관찰할 수 없는 동사']]},

  standard:{n:'성취기준', lim:'한 줄',
    crit:['코드와 문장이 함께 있는가','이 차시가 실제로 도달하려는 하나인가'],
    good:['[12진로01-05] 졸업 후 삶의 모습을 구체적으로 구상하며 미래에 대한 긍정적인 태도를 기른다.'],
    bad:[['여러 성취기준을 두루 다룸','어느 것에 도달하려는지 정해지지 않음']]},

  goal0:{n:'학습목표 가(스스로 하는 수준)', lim:'한 줄',
    crit:['도움 없이 해내는 조건인가','관찰할 수 있는 동작인가','"~한다"로 끝나는가'],
    good:['원하는 직업과 준비 과정을 스스로 연결해 실천 계획서를 완성한다'],
    bad:[['미래 계획을 잘 세울 수 있다','"잘"은 확인할 기준이 없음']]},

  goal1:{n:'학습목표 나(단서를 주면 하는 수준)', lim:'한 줄',
    crit:['주는 단서가 무엇인지 밝혔는가','가와 도움의 종류가 다른가'],
    good:['보기 카드를 골라 실천 계획서의 빈칸을 채운다'],
    bad:[['조금 도와주면 계획서를 작성한다','도움의 종류가 무엇인지 없어 가와 길이만 다름']]},

  goal2:{n:'학습목표 다(함께 참여하는 수준)', lim:'한 줄',
    crit:['교사와 함께 하는 행동이 있는가','태도 서술이 아니라 참여 행동인가'],
    good:['교사와 함께 생성된 이미지를 보고 하고 싶은 일을 한 문장으로 말한다'],
    bad:[['자신의 미래에 관심을 갖는다','참여 행동이 아니라 태도라 확인할 수 없음']]},

  intent:{n:'수업 의도', lim:'두세 줄',
    crit:['교과 측면의 이유가 있는가','학생 측면의 이유가 있는가','활동 소개가 아니라 이유인가'],
    good:['교과: 졸업을 앞두고 진로를 구체화해야 할 시기라 먼저 다룸. 학생: 미래를 막연하게만 떠올려 이미지로 붙잡아 줄 필요'],
    bad:[['학생들이 즐겁게 참여하도록 설계함','어느 수업에나 해당해 이 차시의 판단이 드러나지 않음'],
         ['먼저 영상을 보고 실습한다','활동 순서 소개일 뿐 이유가 없음']]},

  tools:{n:'AI·디지털 도구', lim:'한두 줄',
    crit:['도구가 하나로 특정되는가','고른 이유가 수업 의도와 이어지는가'],
    good:['미래의 나 AI 생성기(교사 자체 제작) — 내가 꿈꾸는 직업인이 된 모습을 사실적인 이미지로 구현하고, 구체적인 계획과 실천 방안을 구체화하기 위해'],
    bad:[['패들렛, 캔바, 챗GPT 등 다양한 도구 활용','나열만 있고 이유가 없으며 한 차시에 실제로 쓰기 어려움'],
         ['흥미 유발을 위해 영상 활용','흥미 유발은 이유가 아니라 기대']]},

  ai0:{n:'AI 구상 ① 무엇을 개발하는가', lim:'서너 줄',
    crit:['자료의 형태가 있는가','학생이 그것으로 하는 행동이 있는가'],
    good:['미래의 나 AI 생성기. 학생이 고른 직업으로 자기 모습을 이미지로 만들어 봄'],
    bad:[['AI를 활용한 자료를 만든다','형태도 학생 행동도 없음']]},

  ai1:{n:'AI 구상 ② 왜 개발이 필요한가', lim:'서너 줄',
    crit:['기존 방식의 한계가 우리 반 조건으로 구체적인가','기성 도구로는 안 되는 이유인가'],
    good:['말로만 상상하면 막연해 계획서가 채워지지 않고, 기성 이미지 검색으로는 자기 모습이 나오지 않음'],
    bad:[['학생들의 흥미를 높이기 위해 필요하다','기성 도구로도 되는 이유라 직접 제작의 근거가 못 됨']]},

  ai2:{n:'AI 구상 ③ 기대 효과', lim:'서너 줄',
    crit:['학습 면과 운영 면이 나뉘어 있는가','확인할 수 있는 변화인가'],
    good:['학습: 자기 이미지를 본 뒤 계획서 항목이 구체화됨. 운영: 생성한 이미지가 산출물로 남아 평가 근거가 됨'],
    bad:[['학습 효과가 향상될 것으로 기대된다','무엇이 어떻게 달라지는지 확인할 수 없음']]},

  title:{n:'활동제목', lim:'짧은 이름',
    crit:['학생에게 그대로 말해 줄 수 있는 이름인가'],
    good:['오늘의 빨랫감','세제는 얼마나?'],
    bad:[['동기 유발 및 학습 목표 확인','교사용 절차 명칭이라 학생에게 말할 수 없음']]},

  tAct:{n:'교사가 하는 일', lim:'줄마다 한 가지. 줄 수 제한 없음',
    crit:['교사의 구체적 행동인가','한 줄에 한 가지만 담았는가','안내·제시·질문·실행·지도처럼 무엇을 하는지 드러나는가'],
    good:['미래의 나 이미지를 생성해 화면에 제시한다','계획서 첫 칸을 함께 채우며 시범을 보인다','무엇이 더 필요할지 묻는다'],
    bad:[['학생들이 이해할 수 있도록 지도한다','무엇을 하는지가 없음']]},

  sAct:{n:'학생이 하는 일', lim:'줄마다 한 가지. 줄 수 제한 없음',
    crit:['학생이 실제로 하는 동작이나 말인가','시청·확인·작성·답변·검토·제출처럼 관찰되는 행동인가'],
    good:['생성된 이미지를 보고 어떤 직업인지 말한다','계획서 두 번째 칸을 작성한다','완성한 계획서를 제출한다'],
    bad:[['교사의 설명을 주의 깊게 듣는다','확인할 수 없는 수동적 서술']]},

  tool:{n:'디지털 도구', lim:'짧게',
    crit:['도구가 하나로 특정되는가','쓰지 않기로 했다면 미사용이라고 적었는가'],
    good:['미래의 나 AI 생성기','캔바','미사용'],
    bad:[['각종 에듀테크 도구','무엇인지 특정되지 않음']]},

  role:{n:'디지털 도구의 역할', lim:'한두 줄',
    crit:['그 단계에서 도구가 대신하거나 돕는 일이 구체적인가','미사용이면 쓰지 않는 이유가 있는가'],
    good:['말로 설명하기 어려운 미래 모습을 이미지로 즉시 보여 줌','미사용 — 자기 손으로 먼저 써 보게 하려고'],
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
    '교사가 쓴 초안을 다듬어라. 요약이 목적이 아니다.',
    '- 초안에 담긴 정보는 하나도 빼지 마라. 항목이 여러 개면 모두 살린다.',
    '- 길이는 초안과 비슷하게 유지한다. 짧게 줄이지 마라. 필요하면 초안보다 길어져도 된다.',
    '- 초안이 줄로 나뉘어 있으면 그 줄 구분을 그대로 유지한다.',
    '- 고치는 것은 어법, 맞춤법, 문체, 용어, 문장 구조다. 모호한 표현은 판정 기준에 비추어 또렷하게 다듬되, 초안에 없는 사실을 지어내지 마라.',
    '- 판정 기준 중 초안이 아예 담고 있지 않은 것이 있으면, 그 자리를 임의로 채우지 말고 notes에 무엇이 빠졌는지 적어라.',
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
  let body = req.body;
  if (typeof body === 'string'){ try { body = JSON.parse(body); } catch(_){ body = {}; } }
  body = body || {};

  // INVITE_CODES를 비워 두면 코드 없이 누구나 사용할 수 있습니다.
  if (codes.length && !codes.includes(String(body.code || '').trim()))
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
