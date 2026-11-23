use contract_syntax::{parse, Attr, BinOp, Component, Expr, FnDecl, Node, Span, TemplatePart};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

type Catalog = BTreeMap<String, String>;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut problems = Vec::new();
    let english = read_catalog(&app.join("strings/en.json"))?;
    for locale in ["ar", "hi"] {
        if !app.join(format!("strings/{locale}.json")).is_file() {
            problems.push(format!("strings/{locale}.json: missing required catalog"));
        }
    }
    for path in files(&app.join("strings"), "json", false)? {
        let catalog = read_catalog(&path)?;
        let name = path.strip_prefix(&app)?.display();
        problems.extend(catalog_issues(&english, &catalog).map(|issue| format!("{name}: {issue}")));
    }
    for path in files(&app, "contract", true)? {
        let name = path.strip_prefix(&app)?.display().to_string();
        if name.ends_with(".test.contract") {
            continue;
        }
        let ast = parse(&fs::read_to_string(path)?).map_err(|error| format!("{name}:{error}"))?;
        for component in ast.components.iter().chain(&ast.members) {
            problems.extend(
                copy_issues(component, &ast.fns, &english)
                    .into_iter()
                    .map(|(span, message)| format!("{name}:{span}: {message}")),
            );
        }
    }
    if problems.is_empty() {
        println!("Localization checks passed.");
        Ok(())
    } else {
        Err(format!("localization checks failed:\n{}", problems.join("\n")).into())
    }
}

fn catalog_issues<'a>(
    base: &'a Catalog,
    catalog: &'a Catalog,
) -> impl Iterator<Item = String> + 'a {
    let missing = base.keys().filter(|key| !catalog.contains_key(*key));
    let extra = catalog.keys().filter(|key| !base.contains_key(*key));
    let empty = catalog.iter().filter(|(_, value)| value.trim().is_empty());
    missing
        .map(|key| format!("missing {key}"))
        .chain(extra.map(|key| format!("unexpected {key}")))
        .chain(empty.map(|(key, _)| format!("empty {key}")))
}

fn copy_issues(
    component: &Component,
    functions: &[FnDecl],
    catalog: &Catalog,
) -> BTreeMap<Span, String> {
    let mut check = CopyCheck {
        component,
        functions,
        catalog,
        issues: BTreeMap::new(),
        visited: BTreeSet::new(),
    };
    for node in Node::walk(&component.view) {
        match node {
            Node::Element {
                tag,
                positional,
                attrs,
                ..
            } => {
                if matches!(
                    tag.as_str(),
                    "text" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "label" | "title"
                ) {
                    positional.iter().for_each(|expr| check.value(expr));
                }
                check.attributes(attrs);
            }
            Node::Use { args, .. } => check.attributes(args),
            _ => {}
        }
    }
    check.issues
}

fn read_catalog(path: &Path) -> Result<Catalog, Box<dyn std::error::Error>> {
    Ok(serde_json::from_slice(&fs::read(path)?)
        .map_err(|error| format!("{}: {error}", path.display()))?)
}

fn files(dir: &Path, extension: &str, recursive: bool) -> std::io::Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let kind = entry.file_type()?;
        if name.starts_with('.')
            || matches!(name.as_ref(), "node_modules" | "target" | "dist" | "tools")
        {
            continue;
        }
        if kind.is_dir() && recursive {
            paths.extend(files(&entry.path(), extension, true)?);
        } else if kind.is_file() && entry.path().extension().is_some_and(|ext| ext == extension) {
            paths.push(entry.path());
        }
    }
    paths.sort();
    Ok(paths)
}

struct CopyCheck<'a> {
    component: &'a Component,
    functions: &'a [FnDecl],
    catalog: &'a Catalog,
    issues: BTreeMap<Span, String>,
    visited: BTreeSet<Span>,
}

impl CopyCheck<'_> {
    fn attributes(&mut self, attrs: &[Attr]) {
        for attr in attrs {
            if matches!(
                attr.name.as_str(),
                "aria-label"
                    | "aria-description"
                    | "aria-roledescription"
                    | "aria-valuetext"
                    | "alt"
                    | "placeholder"
                    | "label"
                    | "title"
                    | "text"
            ) {
                self.value(&attr.value);
            }
        }
    }

    fn value(&mut self, expr: &Expr) {
        if !self.visited.insert(expr.span()) {
            return;
        }
        let literal = |text: &str| !text.trim().is_empty();
        match expr {
            Expr::Str(text, _) if literal(text) => self.raw(expr.span()),
            Expr::Template(parts, _) => {
                for part in parts {
                    match part {
                        TemplatePart::Text(text) if literal(text) => self.raw(expr.span()),
                        TemplatePart::Expr(expr) => self.value(expr),
                        _ => {}
                    }
                }
            }
            Expr::Ternary(_, yes, no, _)
            | Expr::Match {
                some: yes,
                none: no,
                ..
            }
            | Expr::Binary(BinOp::Add, yes, no, _) => {
                self.value(yes);
                self.value(no);
            }
            Expr::Ident(name, _) => {
                if let Some(binding) = self
                    .component
                    .derives
                    .iter()
                    .chain(&self.component.states)
                    .find(|binding| binding.name == *name)
                {
                    self.value(&binding.expr);
                }
            }
            Expr::Call(name, args, span) if name == "t" => {
                match args.first() {
                    Some(Expr::Str(key, _)) if self.catalog.contains_key(key) => {}
                    Some(Expr::Str(key, _)) => {
                        self.issues
                            .insert(*span, format!("unknown translation key {key:?}"));
                    }
                    _ => {
                        self.issues
                            .insert(*span, "t() requires a literal translation key".into());
                    }
                }
                args.iter().skip(1).for_each(|arg| self.value(arg));
            }
            Expr::Call(name, _, _)
                if matches!(
                    name.as_str(),
                    "formatNumber" | "formatDate" | "formatTime" | "formatDay"
                ) => {}
            Expr::Call(name, args, _) => {
                if let Some(function) = self
                    .functions
                    .iter()
                    .find(|function| function.name == *name)
                {
                    self.value(&function.body);
                }
                args.iter().for_each(|arg| self.value(arg));
            }
            Expr::NamedArg(_, value, _) | Expr::Some(value, _) => self.value(value),
            _ => {}
        }
    }

    fn raw(&mut self, span: Span) {
        self.issues
            .insert(span, "visible copy must use t(\"key\")".into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_copy_in_conditional_text_and_accessible_attributes() {
        let ast = parse(
            r#"component App
  derive ready = true
  derive missing = "Untranslated"
  view
    column
      text (ready ? t("saved") : missing) testId="status"
      input placeholder=t("missing") aria-label="Name"
      text formatNumber(42, "decimal")
"#,
        )
        .unwrap();
        let base = Catalog::from([("saved".into(), "Saved".into())]);
        let issues = copy_issues(&ast.components[0], &ast.fns, &base);
        let findings: Vec<_> = issues.into_iter().map(|(span, _)| span.line).collect();
        assert_eq!(findings, [3, 7, 7]);
    }

    #[test]
    fn rejects_missing_extra_and_blank_entries() {
        let base = Catalog::from([
            ("first".into(), "First".into()),
            ("second".into(), "Second".into()),
        ]);
        let catalog = Catalog::from([
            ("first".into(), " ".into()),
            ("third".into(), "तीसरा".into()),
        ]);
        assert_eq!(
            catalog_issues(&base, &catalog).collect::<Vec<_>>(),
            ["missing second", "unexpected third", "empty first"]
        );
    }
}
