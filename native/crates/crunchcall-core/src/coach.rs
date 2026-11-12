use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Cue {
    pub kind: &'static str,
    pub message: &'static str,
    pub at: usize,
}

pub fn normalize_pack(pack: &str) -> &'static str {
    let pack = pack.trim();
    let pack = pack.strip_prefix("coach.pack.").unwrap_or(pack);
    match pack {
        "manager" => "manager",
        "sales" => "sales",
        "interview" => "interview",
        _ => "crisp",
    }
}

pub fn scan<S: AsRef<str>>(lines: &[S], pack: &str) -> Vec<Cue> {
    let refs: Vec<&str> = lines.iter().map(|line| line.as_ref()).collect();
    scan_refs(&refs, normalize_pack(pack))
}

fn scan_refs(lines: &[&str], pack: &str) -> Vec<Cue> {
    let mut cues = Vec::new();
    if let Some(at) = talk_ratio(lines) {
        cues.push(cue("talk-ratio", pack, at));
    }
    if let Some(at) = stacked_questions(lines) {
        cues.push(cue("stacked-questions", pack, at));
    }
    for (index, line) in lines.iter().enumerate() {
        if missing_date(line) {
            cues.push(cue("no-date", pack, index));
        }
    }
    if let Some(at) = no_next_steps(lines) {
        cues.push(cue("no-next-steps", pack, at));
    }
    for index in interrupts(lines) {
        cues.push(cue("interrupt", pack, index));
    }
    cues
}

fn cue(kind: &'static str, pack: &str, at: usize) -> Cue {
    Cue {
        kind,
        message: message(kind, pack),
        at,
    }
}

fn message(kind: &str, pack: &str) -> &'static str {
    match (pack, kind) {
        ("manager", "talk-ratio") => {
            "One person is carrying the room. Pull the others in before you decide."
        }
        ("manager", "stacked-questions") => {
            "Questions are stacking. Pause so one answer can land."
        }
        ("manager", "no-date") => "Put a day on that commitment before you leave.",
        ("manager", "no-next-steps") => "Name an owner and a next step before the call ends.",
        ("manager", "interrupt") => "A point got cut off. Go back and let them finish.",
        ("sales", "talk-ratio") => "You are talking over the buyer. Leave them room.",
        ("sales", "stacked-questions") => "Too many questions in a row. Wait for the answer.",
        ("sales", "no-date") => "The next step has no date. Put a day on it.",
        ("sales", "no-next-steps") => "No next step yet. Ask for one before you hang up.",
        ("sales", "interrupt") => "They got cut off. Let the objection finish.",
        ("interview", "talk-ratio") => {
            "One side is doing almost all the talking. Ask them to go on."
        }
        ("interview", "stacked-questions") => {
            "Questions are stacking. Let the last answer finish."
        }
        ("interview", "no-date") => "A follow-up was named without a day.",
        ("interview", "no-next-steps") => "The answer stayed thin. Ask what they would do next.",
        ("interview", "interrupt") => "An answer got cut short. Invite them to finish.",
        (_, "talk-ratio") => "One voice is taking most of the call.",
        (_, "stacked-questions") => "Questions are stacking up.",
        (_, "no-date") => "A commitment landed without a day. Ask for one before you leave.",
        (_, "no-next-steps") => "No owner or next step yet.",
        (_, "interrupt") => "Someone got cut off.",
        _ => "Check the call.",
    }
}

fn talk_ratio(lines: &[&str]) -> Option<usize> {
    if lines.len() < 6 {
        return None;
    }
    let mut counts: Vec<(String, usize)> = Vec::new();
    for line in lines {
        if let Some(name) = speaker_label(line) {
            let key = name.to_lowercase();
            if let Some(slot) = counts.iter_mut().find(|(existing, _)| existing == &key) {
                slot.1 += 1;
            } else {
                counts.push((key, 1));
            }
        }
    }
    let max = counts.into_iter().map(|(_, count)| count).max().unwrap_or(0);
    let total = lines.len();
    if max * 10 >= total * 7 {
        Some(total - 1)
    } else {
        None
    }
}

fn stacked_questions(lines: &[&str]) -> Option<usize> {
    if lines.len() < 4 {
        return None;
    }
    let start = lines.len() - 4;
    let window = &lines[start..];
    if window.iter().filter(|line| line.contains('?')).count() >= 3 {
        let offset = window
            .iter()
            .rposition(|line| line.contains('?'))
            .unwrap_or(3);
        Some(start + offset)
    } else {
        None
    }
}

fn missing_date(line: &str) -> bool {
    let words = words_of(line);
    let commit = ["by", "ship", "send", "deliver", "finish"];
    if !words.iter().any(|word| commit.contains(&word.as_str())) {
        return false;
    }
    !has_date_signal(line, &words)
}

fn has_date_signal(line: &str, words: &[String]) -> bool {
    if line.chars().any(|ch| ch.is_ascii_digit()) {
        return true;
    }
    const DATE_WORDS: &[&str] = &[
        "today",
        "tomorrow",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
    ];
    words.iter().any(|word| DATE_WORDS.contains(&word.as_str()))
}

fn no_next_steps(lines: &[&str]) -> Option<usize> {
    if lines.len() < 8 {
        return None;
    }
    if lines.iter().any(|line| has_owner_or_next(line)) {
        None
    } else {
        Some(lines.len() - 1)
    }
}

fn has_owner_or_next(line: &str) -> bool {
    let lower = line.to_lowercase();
    if lower.contains("i'll") || lower.contains("i’ll") || lower.contains("next step") {
        return true;
    }
    let words = words_of(line);
    words.iter().any(|word| word == "will" || word == "owner" || word == "action")
}

fn interrupts(lines: &[&str]) -> Vec<usize> {
    let mut hits = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if line.contains("[overlap]") {
            hits.push(index);
            continue;
        }
        // Em dash, not a hyphen. The cut-off line is under 4 words and follows another speaker.
        if line.contains('—')
            && line.split_whitespace().count() < 4
            && index > 0
            && speakers_differ(lines[index - 1], line)
        {
            hits.push(index);
        }
    }
    hits
}

fn speakers_differ(previous: &str, current: &str) -> bool {
    match (speaker_label(previous), speaker_label(current)) {
        (Some(left), Some(right)) => !left.eq_ignore_ascii_case(&right),
        (Some(_), None) => true,
        _ => false,
    }
}

fn speaker_label(line: &str) -> Option<String> {
    let line = line.trim();
    let (name, _) = line.split_once(':')?;
    let name = name.trim();
    if name.is_empty() || name.len() > 48 {
        return None;
    }
    let word_count = name.split_whitespace().count();
    if word_count == 0 || word_count > 4 {
        return None;
    }
    if !name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '.' | '\'' | '-' | '_'))
    {
        return None;
    }
    Some(name.to_string())
}

fn words_of(line: &str) -> Vec<String> {
    line.to_lowercase()
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(|word| word.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bland() -> Vec<&'static str> {
        vec![
            "The group discussed the agenda.",
            "Someone described the background.",
            "A point about timing came up.",
            "People compared two options.",
            "The room stayed on that topic.",
            "A risk was named in general.",
            "Notes were still thin.",
            "The call wrapped without a plan.",
        ]
    }

    #[test]
    fn eight_bland_lines_fire_no_next_steps() {
        let cues = scan(&bland(), "crisp");
        assert!(
            cues.iter().any(|cue| cue.kind == "no-next-steps"),
            "expected no-next-steps, got {cues:?}"
        );
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].message, "No owner or next step yet.");
    }

    #[test]
    fn packs_change_wording_only() {
        let crisp = scan(&bland(), "crisp");
        let manager = scan(&bland(), "coach.pack.manager");
        let sales = scan(&bland(), "sales");
        let interview = scan(&bland(), "interview");
        assert_eq!(crisp[0].kind, "no-next-steps");
        assert_eq!(manager[0].kind, crisp[0].kind);
        assert_eq!(sales[0].kind, crisp[0].kind);
        assert_eq!(interview[0].kind, crisp[0].kind);
        assert_ne!(manager[0].message, crisp[0].message);
        assert_ne!(sales[0].message, crisp[0].message);
        assert_ne!(interview[0].message, manager[0].message);
    }

    #[test]
    fn other_rules_fire_on_their_shapes() {
        let ratio = [
            "Alex: one",
            "Alex: two",
            "Alex: three",
            "Alex: four",
            "Alex: five",
            "Blake: six",
        ];
        assert!(scan(&ratio, "crisp").iter().any(|cue| cue.kind == "talk-ratio"));

        let stacked = ["a", "one?", "two?", "three?"];
        assert!(scan(&stacked, "crisp")
            .iter()
            .any(|cue| cue.kind == "stacked-questions"));

        let undated = ["Please send the recap"];
        assert!(scan(&undated, "crisp").iter().any(|cue| cue.kind == "no-date"));
        let dated = ["Please send the recap on Friday"];
        assert!(!scan(&dated, "crisp").iter().any(|cue| cue.kind == "no-date"));

        let cut = ["Alex: the plan is long enough", "Blake: wait—"];
        assert!(scan(&cut, "crisp").iter().any(|cue| cue.kind == "interrupt"));
        let overlap = ["Alex: hello [overlap]"];
        assert!(scan(&overlap, "crisp").iter().any(|cue| cue.kind == "interrupt"));
    }
}
