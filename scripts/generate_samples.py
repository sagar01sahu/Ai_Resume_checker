import os
import zipfile
from xml.sax.saxutils import escape

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "sample_resumes")
os.makedirs(OUT_DIR, exist_ok=True)


def pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def write_text_pdf(filepath: str, lines: list[str]) -> None:
    content_ops = ["BT", "/F1 11 Tf", "50 760 Td", "15 TL"]
    for i, line in enumerate(lines):
        safe = pdf_escape(line)
        if i == 0:
            content_ops.append(f"({safe}) Tj")
        else:
            content_ops.append(f"T* ({safe}) Tj")
    content_ops.append("ET")
    stream_data = "\n".join(content_ops).encode("latin-1", errors="replace")

    objects = []
    objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    objects.append(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
    objects.append(
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n"
    )
    objects.append(
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
    )
    objects.append(
        f"5 0 obj\n<< /Length {len(stream_data)} >>\nstream\n".encode("ascii")
        + stream_data
        + b"\nendstream\nendobj\n"
    )

    header = b"%PDF-1.4\n"
    offsets = []
    body = bytearray()
    current = len(header)
    for obj in objects:
        offsets.append(current)
        body.extend(obj)
        current += len(obj)

    xref_pos = len(header) + len(body)
    xref = [f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii")]
    for off in offsets:
        xref.append(f"{off:010d} 00000 n \n".encode("ascii"))

    trailer = (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n"
    ).encode("ascii")

    with open(filepath, "wb") as f:
        f.write(header)
        f.write(body)
        f.writelines(xref)
        f.write(trailer)


def write_scanned_image_pdf(filepath: str) -> None:
    # Valid PDF containing an embedded raster XObject image and zero text operators
    img_bytes = bytes([200, 200, 200] * 16)  # 4x4 RGB grayscale-ish patch
    stream_ops = b"q\n400 0 0 500 100 150 cm\n/Im1 Do\nQ\n"

    objects = []
    objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    objects.append(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
    objects.append(
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n"
    )
    objects.append(
        f"4 0 obj\n<< /Type /XObject /Subtype /Image /Width 4 /Height 4 "
        f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length {len(img_bytes)} >>\nstream\n".encode("ascii")
        + img_bytes
        + b"\nendstream\nendobj\n"
    )
    objects.append(
        f"5 0 obj\n<< /Length {len(stream_ops)} >>\nstream\n".encode("ascii")
        + stream_ops
        + b"\nendstream\nendobj\n"
    )

    header = b"%PDF-1.4\n"
    offsets = []
    body = bytearray()
    current = len(header)
    for obj in objects:
        offsets.append(current)
        body.extend(obj)
        current += len(obj)

    xref_pos = len(header) + len(body)
    xref = [f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii")]
    for off in offsets:
        xref.append(f"{off:010d} 00000 n \n".encode("ascii"))

    trailer = (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n"
    ).encode("ascii")

    with open(filepath, "wb") as f:
        f.write(header)
        f.write(body)
        f.writelines(xref)
        f.write(trailer)


def write_docx(filepath: str, lines: list[str]) -> None:
    paragraphs = []
    for line in lines:
        paragraphs.append(
            f"<w:p><w:r><w:t xml:space=\"preserve\">{escape(line)}</w:t></w:r></w:p>"
        )
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{''.join(paragraphs)}<w:sectPr/></w:body>"
        "</w:document>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        "</Types>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )
    with zipfile.ZipFile(filepath, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("word/document.xml", document_xml)


JD_LINES = [
    "Senior Backend Developer",
    "Location: Remote / Hybrid",
    "",
    "We need 4+ years building REST APIs with Python and FastAPI, PostgreSQL, Docker and CI/CD.",
    "React is a plus. B.Tech in Computer Science or equivalent.",
    "",
    "Responsibilities:",
    "- Design, build, and scale high-throughput RESTful services using Python and FastAPI.",
    "- Architect PostgreSQL schemas, optimize queries, and manage migrations.",
    "- Containerize microservices with Docker and maintain automated CI/CD pipelines.",
    "- Collaborate with frontend engineers using React when integrating API contracts.",
]

RESUMES = [
    (
        "aarav_mehta.pdf",
        "pdf",
        [
            "Aarav Mehta",
            "Email: aarav.mehta@example.com | Phone: +91-98765-43210",
            "Summary: Senior Backend Engineer with 5 years of experience designing high-throughput",
            "distributed APIs and microservices using Python, FastAPI, PostgreSQL, and Docker.",
            "",
            "Skills: Python, FastAPI, PostgreSQL, RESTful APIs, Docker, React, SQLAlchemy, Redis, Git",
            "",
            "Work Experience:",
            "Senior Backend Developer, FinScale Tech (Jan 2023 - Nov 2026)",
            "- Built low-latency REST APIs with FastAPI and Python serving 12M daily requests.",
            "- Managed PostgreSQL schemas, indexing, and connection pooling in Docker containers.",
            "- Built internal admin views in React to inspect webhook delivery telemetry.",
            "Backend Engineer, CloudBridge Systems (Jan 2021 - Dec 2022)",
            "- Developed microservices with Python, Flask, and Postgres; wrote comprehensive pytest suites.",
            "",
            "Projects:",
            "- Async Order Ledger: High-concurrency event processor in FastAPI and PostgreSQL.",
            "",
            "Education:",
            "B.Tech, Computer Science, National Institute of Technology (2016 - 2020)",
        ],
    ),
    (
        "priya_nair.docx",
        "docx",
        [
            "Priya Nair",
            "Email: priya.nair@example.com | Phone: +91-98201-11442",
            "Summary: Backend Engineer with 4 years experience building scalable web APIs in Python and FastAPI.",
            "",
            "Skills: Python, FastAPI, Postgres, REST APIs, SQLAlchemy, Redis, Pytest, Linux",
            "",
            "Work Experience:",
            "Backend Developer, NovaPay Solutions (Jul 2022 - Nov 2026)",
            "- Architected RESTful services with Python and FastAPI backed by PostgreSQL.",
            "- Improved database query latency by 42% through Postgres indexing and async pooling.",
            "Software Engineer, DataCraft Labs (Jul 2020 - Jun 2022)",
            "- Built data ingestion APIs in Python and Flask with automated unit testing.",
            "",
            "Education:",
            "B.Tech in Information Technology, Anna University (2016 - 2020)",
        ],
    ),
    (
        "rohan_gupta.pdf",
        "pdf",
        [
            "Rohan Gupta",
            "Email: rohan.gupta@example.com | Phone: +91-98112-33901",
            "Summary: Software Engineer with 3.5 years experience in Python backend engineering and relational databases.",
            "",
            "Skills: Python, PostgreSQL, RESTful services, Flask, SQL, Redis, Git",
            "",
            "Work Experience:",
            "Backend Engineer, MetricFlow Analytics (May 2023 - Nov 2026)",
            "- Implemented REST APIs in Python and Flask connected to PostgreSQL analytics clusters.",
            "- Tuned SQL reporting pipelines and built Redis caching for dashboard endpoints.",
            "Junior Developer, ByteWorks Studio (Nov 2021 - Apr 2023)",
            "- Maintained backend services in Python and SQLite/Postgres.",
            "",
            "Education:",
            "B.Tech, Computer Science, Delhi Technological University (2017 - 2021)",
        ],
    ),
    (
        "sneha_iyer.docx",
        "docx",
        [
            "Sneha Iyer",
            "Email: sneha.iyer@example.com | Phone: +91-98450-77219",
            "Summary: Full-Stack Developer with 3 years experience across Python, Django, Docker, and React.",
            "",
            "Skills: Python, Django, Docker, React, TypeScript, MySQL, Git",
            "",
            "Work Experience:",
            "Software Engineer, BrightCart Commerce (Nov 2023 - Nov 2026)",
            "- Developed backend endpoints with Python and Django containerized via Docker.",
            "- Built merchant analytics dashboards in React and TypeScript.",
            "",
            "Education:",
            "B.E. Computer Science, Visvesvaraya Technological University (2019 - 2023)",
        ],
    ),
    (
        "kabir_shah.pdf",
        "pdf",
        [
            "Kabir Shah",
            "Email: kabir.shah@example.com | Phone: +91-98980-44512",
            "Summary: Backend Developer with 2 years of experience writing Python APIs and data tools.",
            "",
            "Skills: Python, REST APIs, Flask, MySQL, Git, Linux",
            "",
            "Work Experience:",
            "Software Developer, LogiTrack Software (Nov 2024 - Nov 2026)",
            "- Built internal REST APIs using Python and Flask integrated with MySQL.",
            "- Automated log parsing scripts on Linux servers.",
            "",
            "Education:",
            "B.Sc Computer Science, University of Mumbai (2021 - 2024)",
        ],
    ),
    (
        "meera_joshi.pdf",
        "pdf",
        [
            "Meera Joshi",
            "Email: meera.joshi@example.com | Phone: +91-97654-12098",
            "Summary: Junior Developer with 1 year experience working on Python scripting and frontend layouts.",
            "",
            "Skills: Python, HTML, CSS, JavaScript, Git",
            "",
            "Work Experience:",
            "Junior Software Engineer, WebNest Agency (Nov 2025 - Nov 2026)",
            "- Created Python automation utilities and responsive landing pages.",
            "",
            "Education:",
            "BCA, Bachelor of Computer Applications, Pune University (2022 - 2025)",
        ],
    ),
    (
        "vikram_rao.pdf",
        "pdf",
        [
            "Vikram Rao",
            "Email: vikram.rao@example.com | Phone: +91-98860-55123",
            "Summary: Principal Backend Engineer with 6 years of experience architecting Python, FastAPI,",
            "PostgreSQL, Docker, and CI/CD platforms at scale.",
            "",
            "Skills: Python, FastAPI, PostgreSQL, REST APIs, Docker, CI/CD, GitHub Actions, Kubernetes, React, AWS",
            "",
            "Work Experience:",
            "Lead Backend Engineer, PulseGrid Cloud (Jan 2023 - Nov 2026)",
            "- Designed microservices in Python and FastAPI handling 40k req/sec with PostgreSQL.",
            "- Standardized Docker builds and GitHub Actions CI/CD pipelines across 14 repositories.",
            "Backend Software Engineer, OrbitData Systems (Nov 2020 - Dec 2022)",
            "- Built RESTful services and React developer portals with automated test pipelines.",
            "",
            "Education:",
            "M.Tech in Computer Science, IIT Madras (2018 - 2020)",
        ],
    ),
    (
        "ananya_desai.docx",
        "docx",
        [
            "Ananya Desai",
            "Email: ananya.desai@example.com | Phone: +91-98230-66789",
            "Summary: Senior Software Engineer with 4.5 years experience in Python, FastAPI, PostgreSQL, and Docker.",
            "",
            "Skills: Python, FastAPI, PostgreSQL, REST APIs, Docker, GitHub Actions, CI/CD, Pytest",
            "",
            "Work Experience:",
            "Backend Engineer, PayStream Core (May 2022 - Nov 2026)",
            "- Built REST APIs with Python, FastAPI, and PostgreSQL with zero-downtime Docker deployments.",
            "- Configured CI/CD workflows in GitHub Actions running pytest and container security scans.",
            "",
            "Education:",
            "B.Tech, Computer Science and Engineering, COEP Pune (2018 - 2022)",
        ],
    ),
    (
        "arjun_verma.pdf",
        "pdf",
        [
            "Arjun Verma",
            "Email: arjun.verma@example.com | Phone: +91-98109-88341",
            "Summary: Backend Engineer with 3 years experience in Python, PostgreSQL, and Dockerized services.",
            "",
            "Skills: Python, Django, PostgreSQL, Docker, REST APIs, Redis, Linux",
            "",
            "Work Experience:",
            "Software Engineer, FleetPulse IoT (Nov 2023 - Nov 2026)",
            "- Engineered telemetry REST APIs using Python, Django, and PostgreSQL.",
            "- Packaged worker nodes in Docker and managed Redis task queues.",
            "",
            "Education:",
            "B.Tech in Electronics and Communication, NIT Trichy (2019 - 2023)",
        ],
    ),
    (
        "divya_menon.docx",
        "docx",
        [
            "Divya Menon",
            "Email: divya.menon@example.com | Phone: +91-98950-22190",
            "Summary: Software Engineer with 2.5 years experience building FastAPI backends and React interfaces.",
            "",
            "Skills: Python, FastAPI, MongoDB, React, TypeScript, REST APIs, Git",
            "",
            "Work Experience:",
            "Full Stack Developer, HealthSync Labs (May 2024 - Nov 2026)",
            "- Built patient portal REST APIs with Python and FastAPI backed by MongoDB.",
            "- Developed interactive clinical tables in React and TypeScript.",
            "",
            "Education:",
            "B.Tech in Information Technology, CUSAT (2020 - 2024)",
        ],
    ),
    (
        "karthik_nair.pdf",
        "pdf",
        [
            "Karthik Nair",
            "Email: karthik.nair@example.com | Phone: +91-98470-99104",
            "Summary: Backend Engineer with 1.5 years experience in Java, Spring Boot, PostgreSQL, and Docker.",
            "",
            "Skills: Java, Spring Boot, PostgreSQL, Docker, REST APIs, Git",
            "",
            "Work Experience:",
            "Software Engineer, CoreLedger Systems (May 2025 - Nov 2026)",
            "- Implemented financial microservices in Java Spring Boot with PostgreSQL and Docker.",
            "",
            "Education:",
            "B.E. Computer Science, PSG College of Technology (2021 - 2025)",
        ],
    ),
]


def main():
    write_text_pdf(os.path.join(OUT_DIR, "senior_backend_jd.pdf"), JD_LINES)
    with open(os.path.join(OUT_DIR, "senior_backend_jd.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(JD_LINES))

    for filename, fmt, lines in RESUMES:
        path = os.path.join(OUT_DIR, filename)
        if fmt == "pdf":
            write_text_pdf(path, lines)
        else:
            write_docx(path, lines)

    write_scanned_image_pdf(os.path.join(OUT_DIR, "scan_resume_07.pdf"))
    print(f"Generated sample JD and 12 synthetic resumes in {OUT_DIR}")


if __name__ == "__main__":
    main()
