const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('./dbConfig');
const verifyToken = require('./authMiddleware');

// Endpoint to insert content details
router.post('/', verifyToken, async (req, res) => {
  const { FormId, ContentHeader, ContentLines, isValidFormFront, isValidFormBack } = req.body;
  const { UserId } = req.user;

  if (!FormId || !ContentHeader || !ContentLines) {
    return res.status(400).json({ message: 'FormId, ContentHeader, and ContentLines are required' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('FormId', sql.Int, FormId)
      .input('ContentHeader', sql.NVarChar, ContentHeader)
      .input('ContentLines', sql.NVarChar, ContentLines)
      .input('isValidFormFront', sql.Bit, isValidFormFront)
      .input('isValidFormBack', sql.Bit, isValidFormBack)
      .input('UserId', sql.Int, UserId)
      .query('INSERT INTO Content_dtl (FormId, ContentHeader, ContentLines, isValidFormFront, isValidFormBack, UserId, isActive) VALUES (@FormId, @ContentHeader, @ContentLines, @isValidFormFront, @isValidFormBack, @UserId, 1)');
    
    res.status(201).json({ message: 'Content details inserted successfully' });
  } catch (err) {
    console.error('Error inserting content details:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Endpoint to get all content details for the logged-in user
router.get('/', verifyToken, async (req, res) => {
  const { UserId } = req.user;

  // Validate UserId from req.user
  if (isNaN(parseInt(UserId)) || !Number.isInteger(parseFloat(UserId))) {
    console.error("Invalid UserId from token:", UserId);
    return res.status(401).json({ message: "Unauthorized: Invalid User ID in token." });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .query(`
        SELECT
            c.C_Id as ContentId,
            c.ContentHeader,
            c.ContentLines,
            c.isValidFormFront,
            c.isValidFormBack,
            f.FormName,
            (
                SELECT TOP 1 fd.BannerImage
                FROM FormDetails_dtl fd
                WHERE fd.FormId = f.FormId AND fd.BannerImage IS NOT NULL
                ORDER BY fd.Id DESC
            ) as BannerImage
        FROM
            Content_dtl c
        JOIN
            FormMaster_dtl f ON c.FormId = f.FormId
        WHERE
            c.isActive = 1
        ORDER BY
            f.FormName, c.C_Id ASC
      `);
    
    const groupedContent = result.recordset.reduce((acc, item) => {
        const { FormName, BannerImage, isValidFormFront, isValidFormBack, ...contentData } = item;
        const formName = FormName || 'Uncategorized';

        if (!acc[formName]) {
            acc[formName] = {
                bannerImage: BannerImage,
                front: [],
                back: []
            };
        }

        const content = {
            ContentId: contentData.ContentId,
            ContentHeader: contentData.ContentHeader,
            ContentLines: contentData.ContentLines
        };

        if (isValidFormFront) {
            acc[formName].front.push(content);
        }
        if (isValidFormBack) {
            acc[formName].back.push(content);
        }

        return acc;
    }, {});

    res.status(200).json(groupedContent);
  } catch (err) {
    console.error('Error fetching all content details:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Endpoint to get content details by FormName
router.get('/form', verifyToken, async (req, res) => {
  const { UserId } = req.user;
        const formId = parseInt(req.headers.formid, 10); // Get formId from headers and parse as integer
        if (isNaN(formId)) {
            return res.status(400).send("Invalid FormId provided.");
        }

  try {
        const pool = await poolPromise;
        console.log('Before input: typeof UserId =', typeof UserId, ', Number.isInteger(UserId) =', Number.isInteger(UserId));
        const request = pool.request();
    let query = `
        SELECT
            c.C_Id as ContentId,
            c.ContentHeader,
            c.ContentLines,
            c.isValidFormFront,
            c.isValidFormBack,
            f.FormName,
            (SELECT TOP 1 fd.BannerImage FROM FormDetails_dtl fd WHERE fd.FormId = f.FormId AND fd.BannerImage IS NOT NULL ORDER BY fd.Id DESC) as BannerImage
        FROM
            Content_dtl c
        JOIN
            FormMaster_dtl f ON c.FormId = f.FormId
        WHERE c.isActive = 1
      `;

    if (formId) {
      query += ' AND c.FormId = @FormId';
      request.input('FormId', sql.Int, formId);
    }
    
    const result = await request.query(query);
    
    const allContent = result.recordset;
    let aggregatedFrontContent = [];
    let aggregatedBackContent = [];
    let firstBannerImage = null;

    allContent.forEach(item => {
      if (item.isValidFormFront) {
        aggregatedFrontContent.push({
          ContentId: item.ContentId,
          ContentHeader: item.ContentHeader,
          ContentLines: item.ContentLines
        });
      }
      if (item.isValidFormBack) {
        aggregatedBackContent.push({
          ContentId: item.ContentId,
          ContentHeader: item.ContentHeader,
          ContentLines: item.ContentLines
        });
      }
      if (item.BannerImage && !firstBannerImage) {
        firstBannerImage = item.BannerImage;
      }
    });

    res.status(200).json({ front: aggregatedFrontContent, back: aggregatedBackContent, bannerImage: firstBannerImage });
  } catch (err) {
    console.error('Error fetching all content details for user:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Endpoint to get content details by FormId with optional filtering
router.get('/:formId', verifyToken, async (req, res) => {
  const { formId } = req.params;

  if (!formId) {
    return res.status(400).json({ message: 'FormId is required' });
  }

  // console.log('Received formId for content details:', formId); // Debugging line

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('FormId', sql.Int, formId)
      .query('SELECT C_Id as ContentId, ContentHeader, ContentLines, isValidFormFront, isValidFormBack FROM Content_dtl WHERE FormId = @FormId AND isActive = 1');
    
    const bannerResult = await pool.request()
      .input('FormId', sql.Int, formId)
      .query('SELECT TOP 1 BannerImage FROM FormDetails_dtl WHERE FormId = @FormId AND BannerImage IS NOT NULL ORDER BY Id DESC');

    const allContent = result.recordset;
    const frontContent = allContent.filter(item => item.isValidFormFront);
    const backContent = allContent.filter(item => item.isValidFormBack);
    const bannerImage = bannerResult.recordset.length > 0 ? bannerResult.recordset[0].BannerImage : null;

    res.status(200).json({ front: frontContent, back: backContent, bannerImage: bannerImage });
  } catch (err) {
    console.error('Error fetching content details:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
