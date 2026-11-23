ALTER TABLE document_spaces ADD COLUMN template_set text NOT NULL DEFAULT 'none';
ALTER TABLE document_spaces ADD CONSTRAINT document_spaces_template_set_ck CHECK(template_set IN ('none','general','software'));
